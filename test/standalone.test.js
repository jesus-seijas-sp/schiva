const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const {
  ArrayOf,
  ClosedSchema,
  Const,
  Enum,
  Float,
  Integer,
  OneOf,
  Schema,
  String,
  ValidateType,
  Values,
  compileJsonSchema,
  standaloneCode,
  standaloneJsonSchema,
  standaloneModule,
} = require('../src');
const { HELPER_SOURCES } = require('../src/standalone-helpers');
const { deepEqual } = require('../src/deep-equal');
const { codePointLength } = require('../src/types/code-point-length');
const { hasDuplicates } = require('../src/types/has-duplicates');

// Loads CommonJS source in a context where code generation from strings (eval, new Function) throws. Values are
// made in that context too, so objects compare as they do when the data and the validator share one.
function load(code) {
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  const module = { exports: {} };
  vm.runInContext(`(function (module, exports) {\n${code}\n})`, context)(module, module.exports);
  const parse = vm.runInContext('JSON.parse', context);
  const wrap = (fn) => (value) =>
    JSON.parse(JSON.stringify(fn(value === undefined ? undefined : parse(JSON.stringify(value)))));
  const { exports } = module;
  if (typeof exports === 'function') {
    return wrap(exports);
  }
  return Object.fromEntries(Object.entries(exports).map(([name, fn]) => [name, wrap(fn)]));
}

// Runs a file with Node refusing code generation, as under a strict Content Security Policy.
function runWithoutCodeGeneration(file, code) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schiva-standalone-'));
  const main = path.join(dir, file);
  fs.writeFileSync(main, code);
  try {
    return execFileSync(process.execPath, ['--disallow-code-generation-from-strings', main], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const order = new ClosedSchema({
  id: String({ pattern: /^ORD-\d{8}$/ }),
  status: Enum({ options: ['draft', 'placed'] }),
  lines: ArrayOf({ type: { sku: String({ min: 3 }), qty: Integer({ min: 1 }) }, min: 1, unique: true }),
  total: Float({ min: 0, exclusiveMax: Infinity }),
  currency: Const('EUR'),
  kind: OneOf({ types: [Values({ values: [{ a: 1 }, [1, 2]] }), Integer()], isMandatory: false }),
});
const values = [
  { id: 'ORD-00000001', status: 'draft', lines: [{ sku: 'abc', qty: 1 }], total: 1, currency: 'EUR' },
  {
    id: 'x',
    status: 'sent',
    lines: [
      { sku: 'a', qty: 0 },
      { sku: 'a', qty: 0 },
    ],
    total: -1,
    currency: 'USD',
    extra: 1,
  },
  { id: 'ORD-00000001', status: 'placed', lines: [], total: 2, currency: 'EUR', kind: { a: 1 } },
  { lines: 'no' },
  null,
  'text',
];

describe('Standalone code', () => {
  it('Should give the same results as compile() in every mode, without code generation', () => {
    [{}, { allErrors: false }, { errors: false }].forEach((options) => {
      const compiled = order.compile(options);
      const standalone = load(standaloneCode(order, options));
      values.forEach((value) => expect(standalone(value)).toEqual(compiled(value)));
    });
  });

  it('Should write the helpers it needs into the code, and no others', () => {
    const code = standaloneCode(order);
    expect(code).toContain('function hasDuplicates(');
    expect(code).toContain('function deepEqual(');
    const plain = standaloneCode(new Schema({ a: Integer() }));
    expect(plain).not.toContain('function deepEqual(');
    expect(plain).not.toContain('function hasDuplicates(');
    expect(code).not.toMatch(/new Function|eval\(/);
  });

  it('Should compile JSON Schemas, with their options', () => {
    const address = { $id: 'https://example.com/address', type: 'object', required: ['city'] };
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      properties: { address: { $ref: 'https://example.com/address' }, tags: { type: 'array', uniqueItems: true } },
      unevaluatedProperties: false,
    };
    const options = { schemas: [address] };
    const compiled = compileJsonSchema(schema, options);
    const standalone = load(standaloneJsonSchema(schema, options));
    [{ address: { city: 'x' } }, { address: {}, tags: [1, 1], other: 1 }].forEach((value) =>
      expect(standalone(value)).toEqual(compiled(value))
    );
  });

  it('Should export several validators by name', () => {
    const exported = load(standaloneModule({ validateOrder: order, isName: String({ min: 1 }) }, { errors: false }));
    expect(Object.keys(exported)).toEqual(['validateOrder', 'isName']);
    expect(exported.validateOrder(values[0])).toBe(true);
    expect(exported.isName('')).toBe(false);
  });

  it('Should run as CommonJS and as an ES module with Node refusing code generation', () => {
    const run = `const value = { id: 'x', status: 'draft', lines: [], total: 1, currency: 'EUR' };\n`;
    const cjs = `${standaloneCode(order)}\n${run}console.log(JSON.stringify(module.exports(value)));\n`;
    const esm = `${standaloneModule({ validateOrder: order }, { format: 'esm' })}\n${run}console.log(JSON.stringify(validateOrder(value)));\n`;
    const expected = JSON.stringify(
      order.compile()({ id: 'x', status: 'draft', lines: [], total: 1, currency: 'EUR' })
    );
    expect(runWithoutCodeGeneration('validate.cjs', cjs).trim()).toBe(expected);
    expect(runWithoutCodeGeneration('validate.mjs', esm).trim()).toBe(expected);
    const defaultExport = standaloneCode(order, { format: 'esm' });
    expect(defaultExport).toContain('export default validate;');
  });

  it('Should write helpers that behave as the library functions they copy', () => {
    // The sources are text in standalone-helpers.js; they must stay equal to the functions of the library.
    // Made in the realm of this test (Jest runs it in a context of its own), like the library functions, so Map, Set
    // and typed arrays are the same classes for both.
    const names = Object.keys(HELPER_SOURCES);
    const sources = Object.values(HELPER_SOURCES).map(({ source }) => source);
    // eslint-disable-next-line no-new-func -- the sources are the library's own
    const copies = new Function(`${sources.join('\n')}\nreturn { ${names.join(', ')} };`)();
    const copy = (name) => copies[name];
    // An array with a hole at index 1.
    const holes = [1];
    holes[2] = undefined;
    ['', 'abc', '\uD83D\uDE00x', '\uD83D', 'a\uDE00b'].forEach((value) =>
      expect(copy('codePointLength')(value)).toBe(codePointLength(value))
    );
    const samples = [
      1,
      NaN,
      'a',
      null,
      undefined,
      [1, [2]],
      { a: [1] },
      { a: [2] },
      new Map([[1, 2]]),
      new Set([1]),
      new Uint8Array([1]),
    ];
    samples.forEach((a) => samples.forEach((b) => expect(copy('deepEqual')(a, b)).toBe(deepEqual(a, b))));
    [[1, 2, 1], [{ a: 1 }, { a: 1 }], [NaN, NaN], [[1], [2]], holes].forEach((value) =>
      expect(copy('hasDuplicates')(value)).toBe(hasDuplicates(value))
    );
  });

  it('Should throw on what cannot be written out', () => {
    class Even extends ValidateType {
      validate(value, fieldName = 'Value') {
        return super.validate(value, fieldName) || (value % 2 === 0 ? undefined : `${fieldName} must be even`);
      }
    }
    expect(() => standaloneCode(new Schema({ n: new Even() }))).toThrow(
      'Standalone code cannot contain types of your own (Even)'
    );
    expect(() => standaloneCode(Values({ values: [new Date(0)] }))).toThrow('Standalone code cannot contain the value');
    expect(() => standaloneCode(Integer(), { format: 'amd' })).toThrow('"amd" is not "commonjs" or "esm"');
    expect(() => standaloneModule({ 'not-a-name': Integer() })).toThrow('is not a valid JavaScript name');
    expect(() => standaloneModule({ deepEqual: ArrayOf({ unique: true }) })).toThrow('is the name of a helper');
    expect(() => standaloneModule({})).toThrow('expects an object of types');
  });
});
