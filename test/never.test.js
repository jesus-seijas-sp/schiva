const { Never, compileJsonSchema, fromJsonSchema, never, toErrors } = require('../src');

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

describe('Never', () => {
  it('Should reject every value', () => {
    expect(Never().validate(1)).toBe('Value is not allowed');
    expect(Never().validate('x', 'id')).toBe('id is not allowed');
    expect(Never().validate(null)).toBe('Value cannot be null');
    expect(Never().isValid({})).toBe(false);
  });

  it('Should follow isMandatory and isNullable', () => {
    expect(Never().validate(undefined)).toBe('Value is mandatory');
    expect(never().validate(undefined)).toBeUndefined();
    expect(never(false, true).isValid(null)).toBe(true);
    expect(never({ isNullable: true }).isValid(undefined)).toBe(true);
  });
});

describe('JSON Schema false', () => {
  it('Should reject every value at the root', () => {
    expect(errorsOf(false, [1, 'x', {}, null])).toEqual([
      ['Value is not allowed'],
      ['Value is not allowed'],
      ['Value is not allowed'],
      ['Value cannot be null'],
    ]);
  });

  it('Should forbid a property while allowing it to be absent', () => {
    const json = { type: 'object', properties: { foo: false, bar: true } };
    expect(errorsOf(json, [{}, { bar: 1 }, { foo: 1 }, { foo: null }])).toEqual([
      [],
      [],
      ['foo is not allowed'],
      ['foo cannot be null'],
    ]);
  });

  it('Should reject a required property whether present or not', () => {
    const json = { type: 'object', required: ['foo'], properties: { foo: false } };
    expect(errorsOf(json, [{}, { foo: 1 }])).toEqual([['foo is mandatory'], ['foo is not allowed']]);
  });

  it('Should reject every item', () => {
    expect(errorsOf({ type: 'array', items: false }, [[], [1, 2]])).toEqual([
      [],
      ['Value[0] is not allowed', 'Value[1] is not allowed'],
    ]);
  });

  it('Should work in not, oneOf, anyOf and references', () => {
    expect(errorsOf({ not: false }, [1, null])).toEqual([[], []]);
    expect(errorsOf({ oneOf: [true, false, false] }, [1])).toEqual([[]]);
    // Each error once, though both alternatives give it.
    expect(errorsOf({ oneOf: [false, false] }, [1])).toEqual([['Value is not allowed']]);
    expect(errorsOf({ anyOf: [false, { type: 'integer' }] }, [1, 'x'])).toEqual([
      [],
      ['Value is not allowed', 'Value must be a number'],
    ]);
    expect(errorsOf({ $ref: '#/definitions/none', definitions: { none: false } }, [1])).toEqual([
      ['Value is not allowed'],
    ]);
  });

  it('Should still throw on values that are not schemas', () => {
    expect(() => fromJsonSchema({ type: 'object', properties: { a: 1 } })).toThrow(
      'Unsupported JSON Schema at #.properties.a: expected an object or a boolean'
    );
  });
});
