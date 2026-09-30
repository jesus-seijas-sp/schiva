const vm = require('vm');
const {
  Schema,
  String,
  builtInFormats,
  compileJsonSchema,
  fromJsonSchema,
  standaloneJsonSchema,
  toErrors,
} = require('../src');
const { FORMATS, FORMAT_FUNCTIONS, matchesFormat } = require('../src/formats');
const { HELPER_SOURCES } = require('../src/standalone-helpers');

// Every compiled mode and the uncompiled type give the same verdict and messages.
function check(schema, value, options) {
  const errors = compileJsonSchema(schema, options)(value);
  expect(compileJsonSchema(schema, { ...options, allErrors: false })(value)).toEqual(errors.slice(0, 1));
  expect(compileJsonSchema(schema, { ...options, errors: false })(value)).toBe(errors.length === 0);
  const type = fromJsonSchema(schema, options);
  expect(type.isValid(value)).toBe(errors.length === 0);
  expect(errors.length === 0 ? [] : toErrors(type.errors(value))).toEqual(errors);
  return errors;
}

const schema = {
  properties: {
    email: { type: 'string', format: 'email' },
    when: { format: 'date' },
    id: { type: ['string', 'null'], format: 'uuid' },
    phone: { format: 'phone' },
  },
};
const value = { email: 'x', when: '2026-02-30', id: 'nope', phone: '12' };

describe('Formats', () => {
  it('Should not check formats without the option, as they are annotations', () => {
    expect(check(schema, value)).toEqual([]);
  });

  it('Should check every built-in format with formats: true', () => {
    // "phone" is not a built-in format: it is named as known but not checked.
    const formats = { ...builtInFormats(), phone: false };
    expect(check(schema, value, { formats })).toEqual([
      'email must be a valid email',
      'when must be a valid date',
      'id must be a valid uuid',
    ]);
    expect(check(schema, { email: 'a@example.com', when: '2024-02-29', id: null }, { formats })).toEqual([]);
    expect(builtInFormats()).toEqual(Object.fromEntries(Object.keys(FORMATS).map((name) => [name, true])));
  });

  it('Should throw on a format the option does not name, as ajv does in strict mode, or ignore it with strict: false', () => {
    const typo = { properties: { email: { type: 'string', format: 'emial' } } };
    expect(() => compileJsonSchema(typo, { formats: true })).toThrow(
      'Unknown JSON Schema format "emial" at #.properties.email: name it in the option "formats" ({ "emial": false } leaves it unchecked), or use strict: false'
    );
    expect(check(typo, { email: 'x' }, { formats: true, strict: false })).toEqual([]);
    // Without the option, "format" is an annotation, and any name is accepted.
    expect(check(typo, { email: 'x' })).toEqual([]);
    // A list names the only formats known.
    expect(() => compileJsonSchema({ format: 'uuid' }, { formats: ['email'] })).toThrow(
      'Unknown JSON Schema format "uuid"'
    );
    // Also in schemas reached through "$ref", and on values of other types (OpenAPI's int32).
    const referenced = { $defs: { a: { format: 'nope' } }, properties: { x: { $ref: '#/$defs/a' } } };
    expect(() => compileJsonSchema(referenced, { formats: true })).toThrow('format "nope" at #/$defs/a');
    const openApi = { properties: { n: { type: 'integer', format: 'int32' }, e: { type: 'string', format: 'email' } } };
    expect(() => compileJsonSchema(openApi, { formats: true })).toThrow('Unknown JSON Schema format "int32"');
    expect(check(openApi, { n: 1, e: 'x' }, { formats: { ...builtInFormats(), int32: false } })).toEqual([
      'e must be a valid email',
    ]);
  });

  it('Should check only the formats a list names', () => {
    expect(check(schema, value, { formats: ['date'], strict: false })).toEqual(['when must be a valid date']);
    const onlyDate = { date: true, email: false, uuid: false, phone: false };
    expect(check(schema, value, { formats: onlyDate })).toEqual(['when must be a valid date']);
  });

  it('Should check formats of your own, a regular expression or a function', () => {
    const formats = { phone: /^\+\d+$/, email: true, even: (text) => text.length % 2 === 0, date: false, uuid: false };
    const own = { properties: { ...schema.properties, code: { format: 'even' } } };
    expect(check(own, { phone: '12', email: 'a@b.co', code: 'abc' }, { formats })).toEqual([
      'phone must be a valid phone',
      'code must be a valid even',
    ]);
  });

  it('Should only check strings', () => {
    expect(check({ format: 'date' }, 20260101, { formats: true })).toEqual([]);
    expect(check({ type: 'integer', format: 'date' }, 1, { formats: true })).toEqual([]);
  });

  it('Should throw on a wrong option', () => {
    expect(() => compileJsonSchema({}, { formats: ['phone'] })).toThrow('"phone" is not one of date, time');
    expect(() => compileJsonSchema({}, { formats: { a: 1 } })).toThrow(
      '"a" must be true, false, a regular expression, a function or { validate, compare }'
    );
    expect(() => compileJsonSchema({}, { formats: 'all' })).toThrow('expected true, a list of names or an object');
  });

  it('Should check the format of a String of the DSL', () => {
    const person = new Schema({
      email: String({ format: 'email' }),
      site: String({ format: 'uri', isMandatory: false }),
    });
    expect(person.compile()({ email: 'x', site: 'no scheme' })).toEqual([
      'email must be a valid email',
      'site must be a valid uri',
    ]);
    expect(person.validate({ email: 'a@b.co' })).toEqual([]);
    expect(() => String({ format: 'phone' })).toThrow('Unknown String format "phone"');
  });

  it('Should check the common formats', () => {
    const cases = {
      'date-time': [
        ['2026-09-30T10:00:00Z', true],
        ['2026-09-30 10:00:00', false],
        ['1990-12-31T23:59:60Z', true],
      ],
      time: [
        ['23:59:59+02:00', true],
        ['24:00:00Z', false],
        ['08:30:06', false],
      ],
      duration: [
        ['P1Y2M3DT4H5M6S', true],
        ['P2W', true],
        ['PT', false],
        ['P1Y2W', false],
      ],
      email: [
        ['"joe bloggs"@example.com', true],
        ['joe@[IPv6:::1]', true],
        ['.joe@example.com', false],
      ],
      hostname: [
        ['www.example.com', true],
        ['-a.com', false],
        ['xn--X', false],
        ['a'.repeat(64), false],
      ],
      'idn-hostname': [
        ['\uC2E4\uB840.\uD14C\uC2A4\uD2B8', true],
        ['l\u00B7l', true],
        ['a\u00B7l', false],
      ],
      ipv4: [
        ['192.168.0.1', true],
        ['256.0.0.1', false],
        ['01.0.0.1', false],
      ],
      ipv6: [
        ['::1', true],
        ['1:2:3:4:5:6:7:8', true],
        ['1::2::3', false],
        ['::ffff:192.168.0.1', true],
      ],
      uri: [
        ['https://example.com/a?b#c', true],
        ['//example.com', false],
        ['https://[::1]:80/', true],
      ],
      'uri-reference': [
        ['//example.com', true],
        ['a b', false],
      ],
      iri: [['https://\u00E9xample.com/', true]],
      uuid: [
        ['2eb8aa08-aa98-11ea-b4aa-73b441d16380', true],
        ['2eb8aa08aa9811eab4aa73b441d16380', false],
      ],
      'uri-template': [
        ['http://example.com/{user.id}/{?q,lang}', true],
        ['{', false],
      ],
      'json-pointer': [
        ['/a~1b/0', true],
        ['a', false],
      ],
      'relative-json-pointer': [
        ['1/a', true],
        ['0#', true],
        ['-1', false],
      ],
      regex: [
        ['^[a-z]+$', true],
        ['[', false],
      ],
    };
    Object.entries(cases).forEach(([format, samples]) =>
      samples.forEach(([text, expected]) =>
        expect([format, text, matchesFormat(FORMATS[format], text)]).toEqual([format, text, expected])
      )
    );
  });

  it('Should write the format helpers into standalone code, and run them without code generation', () => {
    const formats = { ...builtInFormats(), phone: false };
    const code = standaloneJsonSchema(schema, { formats });
    expect(code).toContain('function isEmail(');
    expect(code).toContain('function isDate(');
    expect(code).not.toContain('function isIdnHostname(');
    const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
    const module = { exports: {} };
    vm.runInContext(`(function (module) {\n${code}\n})`, context)(module);
    const parse = vm.runInContext('JSON.parse', context);
    const compiled = compileJsonSchema(schema, { formats });
    expect(JSON.parse(JSON.stringify(module.exports(parse(JSON.stringify(value)))))).toEqual(compiled(value));
    // A regular expression of your own can be written out; a function cannot.
    const others = { email: false, date: false, uuid: false };
    expect(standaloneJsonSchema(schema, { formats: { ...others, phone: /^\+\d+$/ } })).toContain('new RegExp(');
    expect(() => standaloneJsonSchema(schema, { formats: { ...others, phone: (text) => text !== '' } })).toThrow(
      'Standalone code cannot contain the function'
    );
  });

  it('Should keep the helpers of standalone code in sync with the format functions', () => {
    // The sources are text in standalone-helpers.js (npm run build:helpers writes them).
    const names = Object.keys(HELPER_SOURCES);
    const sources = Object.values(HELPER_SOURCES).map(({ source }) => source);
    // eslint-disable-next-line no-new-func -- the sources are the library's own
    const copies = new Function(`${sources.join('\n')}\nreturn { ${names.join(', ')} };`)();
    const samples = [
      '',
      'a',
      '2024-02-29',
      '2023-02-29',
      '23:59:60Z',
      '2026-09-30T10:00:00.5+01:00',
      'P1D',
      'a@b.co',
      '"a b"@c.d',
      'a@[127.0.0.1]',
      'xn--9n2bp8q.xn--9t4b11yi5a',
      'xn--ll-0ea',
      '\u0628\u064A\u200C\u0628\u064A',
      '::1',
      '1.2.3.4',
      '[',
      '\uFF10\uFF11',
    ];
    Object.entries(FORMAT_FUNCTIONS)
      .filter(([name]) =>
        [
          'isDate',
          'isTime',
          'isDateTime',
          'isDuration',
          'isEmail',
          'isIdnEmail',
          'isHostname',
          'isIdnHostname',
          'isIpv4',
          'isIpv6',
          'isRegex',
        ].includes(name)
      )
      .forEach(([name, fn]) =>
        samples.forEach((sample) => expect([name, sample, copies[name](sample)]).toEqual([name, sample, fn(sample)]))
      );
    expect(Object.keys(FORMAT_FUNCTIONS).every((name) => names.includes(name))).toBe(true);
  });
});
