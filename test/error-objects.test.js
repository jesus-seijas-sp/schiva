const vm = require('vm');
const {
  AllOf,
  ArrayOf,
  ClosedSchema,
  Float,
  Integer,
  Schema,
  String: StringType,
  ValidateType,
  compileJsonSchema,
  standaloneCode,
} = require('../src');
const { errorObject, pathName } = require('../src/error-objects');
const { HELPER_SOURCES } = require('../src/standalone-helpers');

const order = new ClosedSchema({
  id: StringType({ pattern: /^O-/ }),
  lines: ArrayOf({ type: { sku: StringType(), price: Float({ min: 0 }) } }),
  count: Integer(),
});

describe('Error objects', () => {
  it('Should give each error as an object with its path, pointer, keyword, params and message', () => {
    expect(order.compile({ errors: 'objects' })({ id: 1, lines: [{ sku: 'a', price: -1 }], extra: true })).toEqual([
      { path: ['id'], pointer: '/id', keyword: 'type', params: { type: 'string' }, message: 'id must be a string' },
      {
        path: ['lines', 0, 'price'],
        pointer: '/lines/0/price',
        keyword: 'minimum',
        params: { limit: 0 },
        message: 'lines[0].price must be at least 0',
      },
      { path: ['count'], pointer: '/count', keyword: 'required', params: {}, message: 'count is mandatory' },
      {
        path: ['extra'],
        pointer: '/extra',
        keyword: 'additionalProperties',
        params: { property: 'extra' },
        message: 'Unexpected key: extra',
      },
    ]);
  });

  it('Should give the same messages as the errors as strings, in every mode', () => {
    const values = [
      { id: 1 },
      { id: 'O-1', lines: [{ sku: 1, price: 'x' }], count: 1.5 },
      null,
      'text',
      { id: 'x', count: 1 },
    ];
    values.forEach((value) => {
      expect(
        order
          .compile({ errors: 'objects' })(value)
          .map((error) => error.message)
      ).toEqual(order.compile()(value));
      expect(
        order
          .compile({ errors: 'objects', allErrors: false })(value)
          .map((error) => error.message)
      ).toEqual(order.compile({ allErrors: false })(value));
    });
    expect(order.compile({ errors: 'objects' })({ id: 'O-1', lines: [], count: 1 })).toEqual([]);
  });

  it('Should name paths as the messages do, empty keys and root arrays included', () => {
    const schema = new Schema({ '': { '': Integer() }, a: ArrayOf({ type: ArrayOf({ type: Integer() }) }) });
    const value = { '': { '': 'x' }, a: [['y']] };
    expect(
      schema
        .compile({ errors: 'objects' })(value)
        .map((error) => error.message)
    ).toEqual(schema.compile()(value));
    const list = ArrayOf({ type: { a: Integer() } });
    expect(list.compile({ errors: 'objects' })([{ a: 'x' }])[0]).toMatchObject({
      path: [0, 'a'],
      message: 'Value[0].a must be a number',
    });
    expect(pathName([])).toBe('Value');
    expect(pathName([2])).toBe('Value[2]');
    expect(pathName(['a', 1, 'b'])).toBe('a[1].b');
    expect(pathName(['a', { key: 'k' }])).toBe('Key a.k');
  });

  it('Should escape the JSON Pointer of keys with ~ and /', () => {
    expect(errorObject(['a/b', 'c~d', 3], 'type', {}, 'x').pointer).toBe('/a~1b/c~0d/3');
  });

  it('Should mark the errors of propertyNames', () => {
    const validate = compileJsonSchema({ propertyNames: { maxLength: 2 } }, { errors: 'objects' });
    expect(validate({ abc: 1 })).toEqual([
      {
        path: ['abc'],
        pointer: '/abc',
        keyword: 'maxLength',
        params: { limit: 2 },
        message: 'Key abc must be at most 2 characters long',
        propertyName: true,
      },
    ]);
  });

  it('Should give the keywords of JSON Schema', () => {
    const validate = compileJsonSchema(
      {
        type: 'object',
        properties: { n: { exclusiveMaximum: 5 }, m: { multipleOf: 2 }, s: { enum: ['a', 'b'] }, c: { const: 1 } },
        dependencies: { card: ['cvv'] },
        maxProperties: 4,
      },
      { errors: 'objects' }
    );
    const errors = validate({ n: 7, m: 3, s: 'x', c: 2, card: 1 });
    expect(errors.map(({ keyword, params }) => [keyword, params])).toEqual([
      ['exclusiveMaximum', { limit: 5 }],
      ['multipleOf', { multipleOf: 2 }],
      ['enum', { allowedValues: ['a', 'b'] }],
      ['const', { allowedValue: 1 }],
      ['maxProperties', { limit: 4 }],
      ['dependentRequired', { property: 'card', missingProperty: 'cvv' }],
    ]);
    expect(errors[5].path).toEqual(['cvv']);
  });

  it('Should keep each error once, by its message', () => {
    const twice = AllOf({ types: [new Schema({ a: Integer() }), new Schema({ a: Integer({ min: 0 }) })] });
    expect(twice.compile({ errors: 'objects' })({ a: 'x' })).toHaveLength(1);
  });

  it('Should turn the messages of types of your own into errors with the keyword custom', () => {
    class Even extends ValidateType {
      validate(value, fieldName = 'Value') {
        return super.validate(value, fieldName) || (value % 2 === 0 ? undefined : `${fieldName} must be even`);
      }
    }
    const schema = new Schema({ n: new Even() });
    expect(schema.compile({ errors: 'objects' })({ n: 3 })).toEqual([
      { path: ['n'], pointer: '/n', keyword: 'custom', params: { type: 'Even' }, message: 'n must be even' },
    ]);
    expect(schema.compile({ errors: 'objects', allErrors: false })({ n: 3 })).toHaveLength(1);
  });

  it('Should throw on an unknown errors option', () => {
    expect(() => order.compile({ errors: 'object' })).toThrow(
      'Unsupported option "errors": "object" is not true, false or \'objects\''
    );
  });

  it('Should give error objects in standalone code, without code generation', () => {
    const code = standaloneCode(order, { errors: 'objects' });
    expect(code).toContain('function errorObject(');
    const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
    const module = { exports: {} };
    vm.runInContext(`(function (module) {\n${code}\n})`, context)(module);
    const parse = vm.runInContext('JSON.parse', context);
    const value = { id: 1, lines: [{ price: -1 }], extra: true };
    const standalone = JSON.parse(JSON.stringify(module.exports(parse(JSON.stringify(value)))));
    expect(standalone).toEqual(order.compile({ errors: 'objects' })(value));
  });

  it('Should keep the helpers of standalone code in sync with the error functions', () => {
    const names = Object.keys(HELPER_SOURCES);
    const sources = Object.values(HELPER_SOURCES).map(({ source }) => source);
    // eslint-disable-next-line no-new-func -- the sources are the library's own
    const copies = new Function(`${sources.join('\n')}\nreturn { ${names.join(', ')} };`)();
    [[], [0], ['', ''], ['a', 1, { key: 'k' }], ['a/b', '~']].forEach((path) => {
      expect(copies.pathName(path)).toBe(pathName(path));
      expect(copies.errorObject(path, 'k', { a: 1 }, 'm')).toEqual(errorObject(path, 'k', { a: 1 }, 'm'));
    });
  });
});
