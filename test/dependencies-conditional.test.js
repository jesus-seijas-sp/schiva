const {
  Conditional,
  Integer,
  Schema,
  String,
  compileJsonSchema,
  compileType,
  fromJsonSchema,
  toErrors,
} = require('../src');

// Errors of each value, after checking the interpreted type and the compiled functions agree.
function errorsOf(json, values) {
  const type = fromJsonSchema(json);
  const all = compileJsonSchema(json);
  const first = compileJsonSchema(json, { allErrors: false });
  return values.map((value) => {
    const interpreted = type.isValid(value) ? [] : toErrors(type.errors(value));
    expect({ value, errors: all(value) }).toEqual({ value, errors: interpreted });
    expect({ value, errors: first(value) }).toEqual({ value, errors: interpreted.slice(0, 1) });
    return interpreted;
  });
}

describe('Schema dependencies', () => {
  const schema = () =>
    new Schema(
      { a: Integer({ isMandatory: false }) },
      {
        dependencies: [
          { key: 'a', required: ['b', 'c'] },
          { key: 'd', type: new Schema({ e: String() }) },
        ],
      }
    );

  it('Should require the listed properties when the key is present', () => {
    expect(schema().validate({})).toEqual([]);
    expect(schema().validate({ a: 1, b: 2 })).toEqual(['c is mandatory when a is present']);
    expect(schema().validate({ a: 1, b: 2, c: 3 })).toEqual([]);
    expect(schema().isValid({ a: 1 })).toBe(false);
  });

  it('Should check the whole object against the dependent type when the key is present', () => {
    expect(schema().validate({ d: 1 })).toEqual(['e is mandatory']);
    expect(schema().validate({ d: 1, e: 'x' })).toEqual([]);
  });

  it('Should name properties after the field', () => {
    expect(schema().validate({ a: 1 }, 'item')).toEqual([
      'item.b is mandatory when item.a is present',
      'item.c is mandatory when item.a is present',
    ]);
  });

  it('Should ignore keys that are undefined or inherited', () => {
    expect(schema().validate({ a: undefined, d: undefined })).toEqual([]);
    expect(schema().validate(Object.create({ a: 1 }))).toEqual([]);
    expect(compileType(schema())({ a: undefined, d: undefined })).toEqual([]);
    expect(compileType(schema())(Object.create({ a: 1, d: 1 }))).toEqual([]);
  });

  it('Should not pass dependencies to nested schemas built from plain objects', () => {
    const nested = new Schema(
      { inner: { a: Integer({ isMandatory: false }) } },
      { dependencies: [{ key: 'a', required: ['b'] }] }
    );
    expect(nested.validate({ inner: { a: 1 } })).toEqual([]);
  });
});

describe('Conditional', () => {
  const type = () => Conditional({ ifType: Integer(), thenType: Integer({ min: 10 }), elseType: String() });

  it('Should check the then type when the if type passes, and the else type otherwise', () => {
    expect(type().validate(12)).toBeUndefined();
    expect(type().validate(5)).toBe('Value must be at least 10');
    expect(type().validate('x')).toBeUndefined();
    expect(type().validate(true, 'flag')).toBe('flag must be a string');
    expect(type().isValid(5)).toBe(false);
  });

  it('Should accept anything for a missing branch', () => {
    expect(Conditional({ ifType: Integer(), elseType: String() }).isValid(5)).toBe(true);
    expect(Conditional({ ifType: Integer(), thenType: String() }).isValid(true)).toBe(true);
  });

  it('Should check presence itself', () => {
    expect(type().validate(undefined)).toBe('Value is mandatory');
    expect(type().validate(null)).toBe('Value cannot be null');
  });
});

describe('JSON Schema dependencies', () => {
  const json = {
    dependencies: {
      bar: ['foo', 'baz'],
      quux: { properties: { foo: { type: 'integer' } }, required: ['foo'] },
    },
  };

  it('Should require the listed properties', () => {
    expect(errorsOf(json, [{}, { bar: 1 }, { bar: 1, foo: 1, baz: 1 }])).toEqual([
      [],
      ['foo is mandatory when bar is present', 'baz is mandatory when bar is present'],
      [],
    ]);
  });

  it('Should check dependent schemas against the whole object', () => {
    expect(errorsOf(json, [{ quux: 1 }, { quux: 1, foo: 'x' }, { quux: 1, foo: 2 }])).toEqual([
      ['foo is mandatory'],
      ['foo must be a number'],
      [],
    ]);
  });

  it('Should ignore values that are not objects', () => {
    expect(errorsOf(json, [['bar'], 'bar', 12])).toEqual([[], [], []]);
  });

  it('Should support boolean dependent schemas and nested names', () => {
    const nested = { properties: { o: { dependencies: { a: ['b'], c: false, d: true } } } };
    expect(errorsOf(nested, [{ o: { a: 1 } }, { o: { c: 1 } }, { o: { a: 1, b: 1, d: 1 } }])).toEqual([
      ['o.b is mandatory when o.a is present'],
      ['o is not allowed'],
      [],
    ]);
  });

  it('Should throw on dependency lists that are not property names', () => {
    expect(() => fromJsonSchema({ dependencies: { a: [1] } })).toThrow('expected property names');
  });
});

describe('JSON Schema if/then/else', () => {
  const json = { if: { minimum: 10 }, then: { multipleOf: 2 }, else: { type: 'string' } };

  it('Should validate with then when if passes and with else otherwise', () => {
    expect(errorsOf(json, [12, 13, 5, 'x'])).toEqual([
      [],
      ['Value must be a multiple of 2'],
      ['Value must be a string'],
      [],
    ]);
  });

  it('Should accept null when the branch it takes does', () => {
    expect(errorsOf(json, [null])).toEqual([[]]);
    const strict = { if: { type: 'null' }, then: false, else: { type: 'integer' } };
    expect(errorsOf(strict, [null, 1, 'x'])).toEqual([['Value cannot be null'], [], ['Value must be a number']]);
  });

  it('Should work with a single branch and in nested fields', () => {
    expect(errorsOf({ if: { type: 'integer' }, else: { type: 'string' } }, [1, 'x', true])).toEqual([
      [],
      [],
      ['Value must be a string'],
    ]);
    const nested = { type: 'object', properties: { p: { if: { type: 'string' }, then: { minLength: 2 } } } };
    expect(errorsOf(nested, [{ p: 'a' }, { p: 'ab' }, { p: 1 }])).toEqual([
      ['p must be at least 2 characters long'],
      [],
      [],
    ]);
  });

  it('Should ignore then and else without if, and if without them', () => {
    expect(errorsOf({ then: false, else: false }, [1])).toEqual([[]]);
    expect(errorsOf({ if: false }, [1])).toEqual([[]]);
  });

  it('Should never report the errors of the if schema', () => {
    expect(errorsOf({ if: { type: 'string', minLength: 5 }, then: true, else: { type: 'integer' } }, ['abc'])).toEqual([
      ['Value must be a number'],
    ]);
  });
});
