const { compileJsonSchema, standaloneJsonSchema, fromJsonSchema } = require('../src');

// Validates a copy of `data` in every mode (and with the interpreter and standalone code), and checks that each one
// leaves the same data: returns the errors and that data.
function run(schema, data, options) {
  const copy = () => JSON.parse(JSON.stringify(data));
  const results = [];
  const record = (valid, value) => results.push({ valid, value });
  let value = copy();
  const errors = compileJsonSchema(schema, options)(value);
  record(errors.length === 0, value);
  value = copy();
  record(compileJsonSchema(schema, { ...options, errors: false })(value), value);
  value = copy();
  record(fromJsonSchema(schema, options).isValid(value), value);
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func -- loads the generated module
  new Function('module', 'exports', standaloneJsonSchema(schema, options))(module, module.exports);
  value = copy();
  record(module.exports(value).length === 0, value);
  results.forEach((result) => {
    expect(result.valid).toBe(errors.length === 0);
    if (errors.length === 0) {
      expect(result.value).toEqual(results[0].value);
    }
  });
  return { errors, data: results[0].value };
}

describe('useDefaults', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string', default: 'anonymous' },
      tags: { type: 'array', default: [] },
      settings: { type: 'object', properties: { theme: { default: 'light' } }, default: {} },
      nickname: { type: ['string', 'null'], default: 'none' },
    },
    required: ['name'],
  };

  it('Should assign the defaults of missing properties before checking them', () => {
    expect(run(schema, {}, { useDefaults: true })).toEqual({
      errors: [],
      data: { name: 'anonymous', tags: [], settings: { theme: 'light' }, nickname: 'none' },
    });
    expect(run(schema, { name: 'Ann', nickname: null }, { useDefaults: true }).data).toEqual({
      name: 'Ann',
      nickname: null,
      tags: [],
      settings: { theme: 'light' },
    });
  });

  it('Should replace null and empty strings too with useDefaults: empty', () => {
    expect(run(schema, { name: '', nickname: null }, { useDefaults: 'empty' }).data).toMatchObject({
      name: 'anonymous',
      nickname: 'none',
    });
  });

  it('Should assign a new copy each time', () => {
    const validate = compileJsonSchema(schema, { useDefaults: true });
    const first = {};
    const second = {};
    validate(first);
    validate(second);
    expect(first.tags).not.toBe(second.tags);
    expect(first.tags).not.toBe(schema.properties.tags.default);
    // The same in the interpreter, deeply.
    const deep = { properties: { settings: { default: { colors: ['red'], size: 1 } } } };
    const type = fromJsonSchema(deep, { useDefaults: true });
    const value = {};
    expect(type.isValid(value)).toBe(true);
    expect(value.settings).toEqual({ colors: ['red'], size: 1 });
    expect(value.settings.colors).not.toBe(deep.properties.settings.default.colors);
  });

  it('Should check the defaults it assigns', () => {
    const wrong = { properties: { size: { type: 'integer', default: 'big' } } };
    expect(run(wrong, {}, { useDefaults: true }).errors).toEqual(['size must be a number']);
  });

  it('Should assign the defaults of tuples', () => {
    const tuple = { type: 'array', items: [{ default: 1 }, { default: 2 }], minItems: 2 };
    expect(run(tuple, [], { useDefaults: true })).toEqual({ errors: [], data: [1, 2] });
    const prefix = { $schema: 'https://json-schema.org/draft/2020-12/schema', prefixItems: [{ default: 'x' }] };
    expect(run(prefix, [], { useDefaults: true }).data).toEqual(['x']);
  });

  it('Should assign the defaults inside allOf, then, else and references', () => {
    const nested = {
      definitions: { named: { properties: { name: { default: 'n' } } } },
      allOf: [{ $ref: '#/definitions/named' }],
      if: { required: ['kind'] },
      then: { properties: { size: { default: 1 } } },
    };
    expect(run(nested, { kind: 'a' }, { useDefaults: true }).data).toEqual({ kind: 'a', name: 'n', size: 1 });
  });

  it('Should throw on defaults inside anyOf, oneOf, not and if, or ignore them with strict: false', () => {
    const inAnyOf = { anyOf: [{ properties: { a: { default: 1 } } }] };
    expect(() => compileJsonSchema(inAnyOf, { useDefaults: true })).toThrow(
      '"default" of "a" is ignored inside "anyOf", "oneOf", "not" and "if" (useDefaults)'
    );
    expect(run(inAnyOf, {}, { useDefaults: true, strict: false }).data).toEqual({});
    const throughRef = {
      definitions: { d: { properties: { a: { default: 1 } } } },
      oneOf: [{ $ref: '#/definitions/d' }],
    };
    expect(() => compileJsonSchema(throughRef, { useDefaults: true })).toThrow('is ignored inside');
    // Without useDefaults, "default" is an annotation anywhere.
    expect(compileJsonSchema(inAnyOf)({})).toEqual([]);
  });

  it('Should not change the data without the option', () => {
    const data = {};
    compileJsonSchema(schema)(data);
    expect(data).toEqual({});
  });
});

describe('removeAdditional', () => {
  const closed = { type: 'object', properties: { a: {} }, additionalProperties: false };
  const typed = { type: 'object', properties: { a: {} }, additionalProperties: { type: 'string' } };
  const open = { type: 'object', properties: { a: {} } };

  it('Should remove the additional properties where additionalProperties is false with true', () => {
    expect(run(closed, { a: 1, b: 2 }, { removeAdditional: true })).toEqual({ errors: [], data: { a: 1 } });
    expect(run(typed, { a: 1, b: 2 }, { removeAdditional: true })).toEqual({
      errors: ['b must be a string'],
      data: { a: 1, b: 2 },
    });
    expect(run(open, { a: 1, b: 2 }, { removeAdditional: true }).data).toEqual({ a: 1, b: 2 });
  });

  it('Should remove every additional property with all', () => {
    expect(run(open, { a: 1, b: 2 }, { removeAdditional: 'all' }).data).toEqual({ a: 1 });
    expect(run(typed, { a: 1, b: 'x' }, { removeAdditional: 'all' }).data).toEqual({ a: 1 });
    // Only in schemas with "properties" or "additionalProperties", as in ajv.
    expect(run({ type: 'object' }, { b: 2 }, { removeAdditional: 'all' }).data).toEqual({ b: 2 });
  });

  it('Should remove the ones failing additionalProperties with failing', () => {
    expect(run(typed, { a: 1, b: 2, c: 'x' }, { removeAdditional: 'failing' })).toEqual({
      errors: [],
      data: { a: 1, c: 'x' },
    });
    expect(run(closed, { a: 1, b: 2 }, { removeAdditional: 'failing' }).data).toEqual({ a: 1 });
  });

  it('Should keep the keys a pattern matches', () => {
    const patterned = { ...closed, patternProperties: { '^x': {} } };
    expect(run(patterned, { a: 1, x1: 2, b: 3 }, { removeAdditional: true }).data).toEqual({ a: 1, x1: 2 });
  });

  it('Should check "required" and the count of keys before removing them, as ajv does', () => {
    const required = { ...closed, required: ['b'] };
    expect(run(required, { a: 1, b: 2 }, { removeAdditional: true })).toEqual({ errors: [], data: { a: 1 } });
    expect(run({ ...closed, maxProperties: 1 }, { a: 1, b: 2 }, { removeAdditional: true })).toEqual({
      errors: ['Value must have at most 1 properties'],
      data: { a: 1 },
    });
  });

  it('Should remove in nested objects too', () => {
    const nested = { properties: { inner: closed }, additionalProperties: false };
    expect(run(nested, { inner: { a: 1, z: 1 }, z: 1 }, { removeAdditional: true }).data).toEqual({ inner: { a: 1 } });
  });
});

describe('Options', () => {
  it('Should throw on invalid values', () => {
    expect(() => compileJsonSchema({}, { useDefaults: 'yes' })).toThrow(
      'Unsupported JSON Schema option "useDefaults": expected true, false or \'empty\''
    );
    expect(() => compileJsonSchema({}, { removeAdditional: 'some' })).toThrow(
      "Unsupported JSON Schema option \"removeAdditional\": expected true, false, 'all' or 'failing'"
    );
  });

  it('Should throw on a default for "__proto__"', () => {
    expect(() => compileJsonSchema({ properties: { ['__proto__']: { default: 1 } } }, { useDefaults: true })).toThrow(
      '"default" of "__proto__"'
    );
  });
});
