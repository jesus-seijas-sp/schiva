const { Float, Integer, Schema, String, compileJsonSchema, fromJsonSchema, toErrors } = require('../src');

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

describe('multipleOf', () => {
  it('Should accept multiples only', () => {
    const type = Float({ multipleOf: 1.5 });
    expect(type.validate(4.5)).toBeUndefined();
    expect(type.validate(-4.5)).toBeUndefined();
    expect(type.validate(0)).toBeUndefined();
    expect(type.validate(35, 'n')).toBe('n must be a multiple of 1.5');
    expect(type.isValid(35)).toBe(false);
    expect(Integer({ multipleOf: 2 }).isValid(7)).toBe(false);
  });

  it('Should check range limits first', () => {
    expect(Float({ min: 10, multipleOf: 2 }).validate(3)).toBe('Value must be at least 10');
  });

  it('Should apply to numbers in JSON Schema', () => {
    expect(errorsOf({ multipleOf: 0.0001 }, [0.0075, 0.00751, 'x'])).toEqual([
      [],
      ['Value must be a multiple of 0.0001'],
      [],
    ]);
    expect(errorsOf({ type: 'integer', multipleOf: 0.123456789 }, [1e308])).toEqual([
      ['Value must be a multiple of 0.123456789'],
    ]);
  });

  it('Should throw on a multipleOf that is not a positive number', () => {
    expect(() => fromJsonSchema({ multipleOf: 0 })).toThrow('"multipleOf" must be a number greater than 0');
    expect(() => fromJsonSchema({ type: 'number', multipleOf: '2' })).toThrow('greater than 0');
  });
});

describe('patternTypes', () => {
  const schema = () =>
    new Schema(
      { id: String() },
      { isOpen: false, patternTypes: [{ pattern: /^x-/, type: Integer() }], maxProperties: 3 }
    );

  it('Should check keys matching a pattern with its type', () => {
    expect(schema().validate({ id: 'a', 'x-count': 1 })).toEqual([]);
    expect(schema().validate({ id: 'a', 'x-count': 'many' })).toEqual(['x-count must be a number']);
  });

  it('Should not treat matching keys as extra keys', () => {
    expect(schema().validate({ id: 'a', 'x-a': 1, other: 1 })).toEqual(['Unexpected key: other']);
    expect(schema().isValid({ id: 'a', 'x-a': 1, 'x-b': 2 })).toBe(true);
  });

  it('Should keep property counts', () => {
    expect(schema().validate({ id: 'a', 'x-a': 1, 'x-b': 2, 'x-c': 3 })).toEqual([
      'Value must have at most 3 properties',
    ]);
  });
});

describe('JSON Schema patternProperties', () => {
  const json = {
    type: 'object',
    properties: { bar: { type: 'integer' } },
    patternProperties: { '^f': { type: 'string' }, o$: { minLength: 2 } },
    additionalProperties: false,
  };

  it('Should validate every matching key against every matching pattern', () => {
    expect(errorsOf(json, [{ foo: 'ab', bar: 1 }, { foo: 1 }, { fo: 'x' }, { foo: 1, fo: 'x' }])).toEqual([
      [],
      ['foo must be a string'],
      ['fo must be at least 2 characters long'],
      ['foo must be a string', 'fo must be at least 2 characters long'],
    ]);
  });

  it('Should apply properties and patterns together, and additionalProperties to the other keys', () => {
    expect(
      errorsOf(json, [
        { fbar: 'x', bar: 'x' },
        { f: 1, o: 1, x: 1 },
      ])
    ).toEqual([['bar must be a number'], ['f must be a string', 'Unexpected key: x']]);
  });

  it('Should work with additionalProperties schemas and property counts', () => {
    const counted = {
      type: 'object',
      patternProperties: { '^a': { type: 'integer' } },
      additionalProperties: { type: 'string' },
      maxProperties: 2,
    };
    expect(
      errorsOf(counted, [
        { a1: 1, b: 'x' },
        { a1: 'x', b: 1, c: 'y' },
      ])
    ).toEqual([[], ['a1 must be a number', 'b must be a string', 'Value must have at most 2 properties']]);
  });

  it('Should name nested keys and support false schemas', () => {
    const nested = { properties: { x: { type: 'object', patternProperties: { '.': false } } } };
    expect(errorsOf(nested, [{ x: {} }, { x: { k: 1 } }])).toEqual([[], ['x.k is not allowed']]);
  });

  it('Should ignore values that are not objects without type', () => {
    expect(errorsOf({ patternProperties: { '^a': { type: 'integer' } } }, [[1], 'a', { a: 'x' }])).toEqual([
      [],
      [],
      ['a must be a number'],
    ]);
  });
});
