const {
  AllOf,
  AnyOf,
  ArrayOf,
  Integer,
  Schema,
  String,
  StringType,
  Values,
  compileErrors,
  compileFirstError,
  compileIsValid,
  compileJsonSchema,
  compileType,
  fromJsonSchema,
  toErrors,
} = require('../src');
const { CheckType, samples, types } = require('./fixtures/types');

// Results of the compiled function and of the interpreted type for every sample, to compare with toEqual.
function resultsForSamples(create, interpreted, compiled) {
  const type = create();
  const fn = compiled(type);
  return {
    compiled: samples.map((value) => ({ value, result: fn(value) })),
    interpreted: samples.map((value) => ({ value, result: interpreted(type, value) })),
  };
}

describe('compileIsValid', () => {
  it.each(Object.entries(types))('Should agree with isValid for %s', (name, create) => {
    const results = resultsForSamples(create, (type, value) => type.isValid(value), compileIsValid);
    expect(results.compiled).toEqual(results.interpreted);
  });

  it('Should check a custom subclass of a built-in type through its validate', () => {
    class LowerType extends StringType {
      validate(value, fieldName = 'Value') {
        return super.validate(value, fieldName) || (value === value.toLowerCase() ? undefined : `${fieldName} lower`);
      }
    }
    const isValid = compileIsValid(new Schema({ id: new LowerType() }));
    expect(isValid({ id: 'abc' })).toBe(true);
    expect(isValid({ id: 'ABC' })).toBe(false);
    expect(isValid({ id: 1 })).toBe(false);
  });

  it('Should support a type that contains itself', () => {
    const list = ArrayOf();
    list.type = list;
    const isValid = compileIsValid(list);
    expect(isValid([[], [[]]])).toBe(true);
    expect(isValid([[1]])).toBe(false);
  });

  it('Should treat keys with quotes and code as plain data', () => {
    const key = '"); throw new Error("injected"); ("';
    const schema = new Schema({ [key]: Integer(), 'a\nb\\c': String() }, { isOpen: false });
    const isValid = compileIsValid(schema);
    expect(isValid({ [key]: 1, 'a\nb\\c': 'x' })).toBe(true);
    expect(isValid({ [key]: 'x', 'a\nb\\c': 'x' })).toBe(false);
    expect(isValid({ [key]: 1, 'a\nb\\c': 'x', other: 1 })).toBe(false);
    expect(compileType(schema, { allErrors: false })({ [key]: 'x', 'a\nb\\c': 'x' })).toEqual([
      `${key} must be a number`,
    ]);
  });

  it('Should only check own keys of an object', () => {
    const isValid = compileIsValid(new Schema({ id: String() }, { isOpen: false }));
    const value = Object.create({ inherited: 1 });
    value.id = 'x';
    expect(isValid(value)).toBe(true);
  });

  it('Should keep the tree as it was when compiled', () => {
    const type = Integer();
    const isValid = compileIsValid(type);
    type.optional();
    expect(type.isValid(undefined)).toBe(true);
    expect(isValid(undefined)).toBe(false);
  });
});

describe('compileFirstError', () => {
  it.each(Object.entries(types))('Should give the first error of errors() for %s', (name, create) => {
    const results = resultsForSamples(create, (type, value) => toErrors(type.errors(value))[0], compileFirstError);
    expect(results.compiled).toEqual(results.interpreted);
  });

  it('Should name nested fields like validate', () => {
    const schema = new Schema({
      lines: ArrayOf({ type: new Schema({ qty: Integer({ min: 1 }) }) }),
      extra: new Schema({}, { additionalType: Integer() }),
    });
    const firstError = compileFirstError(schema);
    expect(firstError({ lines: [{ qty: 1 }, { qty: 0 }], extra: {} })).toBe('lines[1].qty must be at least 1');
    expect(firstError({ lines: [], extra: { a: 'x' } })).toBe('extra.a must be a number');
    expect(firstError({ lines: [{ qty: 1 }], extra: {} })).toBeUndefined();
  });

  it('Should name the keys of a Schema inside ValidateType containers as the Schema does, like validate', () => {
    const type = AllOf({ types: [new Schema({ id: String() })] });
    expect(compileFirstError(type)({ id: 1 })).toBe('id must be a string');
    expect(type.validate({ id: 1 })).toEqual(['id must be a string']);
    expect(compileFirstError(ArrayOf({ type: Integer() }))([1, 'x'])).toBe('Value[1] must be a number');
  });

  it('Should report custom types with their own messages', () => {
    const schema = new Schema({ id: new CheckType((value) => value === 'x', 'must be x', true) });
    expect(compileFirstError(schema)({ id: 'y' })).toBe('id must be x');
  });
});

describe('compileErrors', () => {
  it.each(Object.entries(types))('Should give every error of errors() for %s', (name, create) => {
    const results = resultsForSamples(
      create,
      (type, value) => (type.isValid(value) ? [] : toErrors(type.errors(value))),
      compileErrors
    );
    expect(results.compiled).toEqual(results.interpreted);
  });

  it('Should collect errors of every failing field and element with their names', () => {
    const schema = new Schema(
      {
        id: String(),
        lines: ArrayOf({ type: new Schema({ qty: Integer({ min: 1 }) }) }),
        extra: new Schema({}, { additionalType: Integer() }),
      },
      { isOpen: false }
    );
    const value = { id: 1, lines: [{ qty: 0 }, { qty: 2 }, { qty: 'x' }], extra: { a: 'x', b: 1, c: null }, other: 1 };
    expect(compileErrors(schema)(value)).toEqual([
      'id must be a string',
      'lines[0].qty must be at least 1',
      'lines[2].qty must be a number',
      'extra.a must be a number',
      'extra.c cannot be null',
      'Unexpected key: other',
    ]);
    expect(compileErrors(schema)(value)).toEqual(schema.validate(value));
  });

  it('Should give the errors of every alternative of a failing AnyOf', () => {
    const type = new Schema({ id: AnyOf({ types: [String({ min: 5 }), Integer()] }) });
    expect(compileErrors(type)({ id: 'abc' })).toEqual([
      'id must be at least 5 characters long',
      'id must be a number',
    ]);
    expect(compileErrors(type)({ id: 7 })).toEqual([]);
  });

  it('Should give the errors of every failing AllOf type, each once', () => {
    const type = AllOf({ types: [new Schema({ a: Integer(), b: Integer() }), new Schema({ c: Integer() })] });
    expect(compileErrors(type)({ a: 'x', b: 'y', c: 'z' })).toEqual([
      'a must be a number',
      'b must be a number',
      'c must be a number',
    ]);
    expect(compileErrors(type)({ a: 1, b: 2, c: 'z' })).toEqual(['c must be a number']);
    const twice = AllOf({ types: [new Schema({ a: Integer() }), new Schema({ a: Integer({ min: 0 }) })] });
    expect(compileErrors(twice)({ a: 'x' })).toEqual(['a must be a number']);
  });

  it('Should flatten the errors of custom types', () => {
    const schema = new Schema({
      a: new CheckType((value) => value === 'x', 'must be x', true),
      b: new CheckType((value) => value === 'y', 'must be y'),
    });
    expect(compileErrors(schema)({ a: 1, b: 2 })).toEqual(['a must be x', 'b must be y']);
  });

  it('Should not call the interpreted errors of built-in types', () => {
    const schema = new Schema({ id: String(), inner: { age: Integer() } });
    const errorsSpy = jest.spyOn(Schema.prototype, 'errors');
    try {
      expect(compileErrors(schema)({ id: 1, inner: { age: 'x' } })).toEqual([
        'id must be a string',
        'inner.age must be a number',
      ]);
      expect(errorsSpy).not.toHaveBeenCalled();
    } finally {
      errorsSpy.mockRestore();
    }
  });
});

describe('compileType', () => {
  const schema = () => new Schema({ id: String(), age: Integer({ min: 18 }) }, { isOpen: false });

  it('Should return every error by default', () => {
    const validate = compileType(schema());
    expect(validate({ id: 'x', age: 20 })).toEqual([]);
    expect(validate({ id: 1, age: 10, extra: true })).toEqual([
      'id must be a string',
      'age must be at least 18',
      'Unexpected key: extra',
    ]);
  });

  it('Should return only the first error with allErrors: false', () => {
    const validate = compileType(schema(), { allErrors: false });
    expect(validate({ id: 'x', age: 20 })).toEqual([]);
    expect(validate({ id: 1, age: 10, extra: true })).toEqual(['id must be a string']);
    expect(validate(undefined)).toEqual(['Value is mandatory']);
  });

  it.each(Object.entries(types))('Should give the same errors as errors() for %s', (name, create) => {
    const results = resultsForSamples(
      create,
      (type, value) => (type.isValid(value) ? [] : toErrors(type.errors(value))),
      (type) => compileType(type)
    );
    expect(results.compiled).toEqual(results.interpreted);
  });
});

describe('compileJsonSchema with allErrors: false', () => {
  it('Should return only the first error', () => {
    const json = {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'tags'],
      properties: { id: { type: 'string' }, tags: { type: 'array', items: { enum: ['a', 'b'] } } },
    };
    const all = compileJsonSchema(json);
    const first = compileJsonSchema(json, { allErrors: false });
    const value = { id: 1, tags: ['a', 'c'], other: 1 };
    expect(all(value)).toEqual(['id must be a string', 'tags[1] must be one of: a, b', 'Unexpected key: other']);
    expect(first(value)).toEqual(['id must be a string']);
    expect(first({ id: 'x', tags: ['a'] })).toEqual([]);
  });
});

describe('errors: false', () => {
  it('Should give true or false from compileJsonSchema', () => {
    const json = { type: 'object', required: ['id'], properties: { id: { type: 'string' } } };
    const isValid = compileJsonSchema(json, { errors: false });
    expect(isValid({ id: 'x' })).toBe(true);
    expect(isValid({ id: 1 })).toBe(false);
    expect(isValid({})).toBe(false);
    expect(compileJsonSchema(json, { errors: false, allErrors: false })({ id: 1 })).toBe(false);
  });

  it.each(Object.entries(types))('Should agree with isValid in compileType for %s', (name, create) => {
    const results = resultsForSamples(
      create,
      (type, value) => type.isValid(value),
      (type) => compileType(type, { errors: false })
    );
    expect(results.compiled).toEqual(results.interpreted);
  });
});

describe('Generated equality', () => {
  const nullProto = Object.assign(Object.create(null), { a: 1 });
  const values = [
    0,
    -0,
    1,
    NaN,
    Infinity,
    -Infinity,
    'a',
    '',
    true,
    false,
    [],
    [1, 2],
    [[1], { a: [true] }],
    {},
    { a: 1 },
    { a: 1, b: { c: [null, 'x'] } },
    { constructor: 1 },
    { valueOf: 2 },
    new Date(0),
    nullProto,
  ];
  const data = [
    ...values,
    null,
    undefined,
    [1, 2, 3],
    [2, 1],
    { a: 1, b: 2 },
    { b: 1 },
    { a: '1' },
    Object.create({ a: 1 }),
    { constructor: Array, length: 0 },
    { length: 0 },
    { 0: 1, 1: 2, length: 2 },
    Object.assign(Object.create({ a: 1 }), { b: 2 }),
    { x: 1 },
    new Date(1),
    Object.assign(Object.create(null), { a: 1 }),
    JSON.parse('{"a": 1, "b": {"c": [null, "x"]}}'),
  ];

  // deepEqual() throws for some values (an own valueOf that is not a function): the compiled code must too.
  const outcome = (fn) => {
    try {
      return fn();
    } catch (e) {
      return 'throws';
    }
  };

  it('Should compare each value like deepEqual', () => {
    values.forEach((value) => {
      const type = Values({ values: [value], isNullable: true, isMandatory: false });
      const isValid = compileIsValid(type);
      data.forEach((item) => {
        expect({ value, item, valid: outcome(() => isValid(item)) }).toEqual({
          value,
          item,
          valid: outcome(() => type.isValid(item)),
        });
      });
    });
  });
});

describe('Inlined checks', () => {
  it('Should fail from inside loops of an inlined alternative', () => {
    const json = {
      anyOf: [
        { type: 'array', items: { type: 'integer' } },
        { type: 'object', additionalProperties: { type: 'string' } },
      ],
    };
    const isValid = compileJsonSchema(json, { errors: false });
    expect(isValid([1, 2])).toBe(true);
    expect(isValid([1, 'x'])).toBe(false);
    expect(isValid({ a: 'x' })).toBe(true);
    expect(isValid({ a: 'x', b: 1 })).toBe(false);
    expect(isValid('x')).toBe(false);
  });

  it('Should keep the same results for alternatives too long to inline', () => {
    const properties = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`key${i}`, { type: 'integer' }]));
    const json = { oneOf: [{ type: 'object', properties, required: ['key0'] }, { type: 'string' }] };
    const type = fromJsonSchema(json);
    const all = compileJsonSchema(json);
    const isValid = compileJsonSchema(json, { errors: false });
    [{ key0: 1 }, { key0: 1, key79: 'x' }, {}, 'x', 1].forEach((value) => {
      expect(isValid(value)).toBe(type.isValid(value));
      expect(all(value)).toEqual(type.isValid(value) ? [] : toErrors(type.errors(value)));
    });
  });
});

describe('compile()', () => {
  it.each(Object.entries(types))('Should give the same results as compileType for %s', (name, create) => {
    const type = create();
    [{}, { allErrors: false }, { errors: false }].forEach((options) => {
      const compiled = type.compile(options);
      const expected = compileType(create(), options);
      samples.forEach((value) => {
        expect({ value, options, result: compiled(value) }).toEqual({ value, options, result: expected(value) });
      });
    });
  });

  it('Should compile schemas and single types', () => {
    const schema = new Schema({ id: String(), age: Integer({ min: 18 }) }, { isOpen: false });
    expect(schema.compile()({ id: 1, age: 10, extra: 1 })).toEqual([
      'id must be a string',
      'age must be at least 18',
      'Unexpected key: extra',
    ]);
    expect(schema.compile({ allErrors: false })({ id: 1 })).toEqual(['id must be a string']);
    expect(schema.compile({ errors: false })({ id: 'x', age: 20 })).toBe(true);
    // Single types give an array of messages, where their validate() gives one message.
    expect(Integer({ min: 1 }).validate(0)).toBe('Value must be at least 1');
    expect(Integer({ min: 1 }).compile()(0)).toEqual(['Value must be at least 1']);
  });

  it('Should not see changes made after compiling', () => {
    const schema = new Schema({ id: String() });
    const validate = schema.compile();
    schema.optional();
    expect(schema.validate(undefined)).toEqual([]);
    expect(validate(undefined)).toEqual(['Value is mandatory']);
    expect(schema.compile()(undefined)).toEqual([]);
  });
});
