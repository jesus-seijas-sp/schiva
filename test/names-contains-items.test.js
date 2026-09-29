const { ArrayOf, Integer, Schema, String, compileJsonSchema, fromJsonSchema, toErrors } = require('../src');

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

describe('Schema propertyNameType', () => {
  const schema = () => new Schema({}, { propertyNameType: String({ max: 3 }) });

  it('Should check every key and name it as a key', () => {
    expect(schema().validate({ a: 1, abc: 2 })).toEqual([]);
    expect(schema().validate({ abcd: 1 })).toEqual(['Key abcd must be at most 3 characters long']);
    expect(schema().validate({ abcd: 1 }, 'item')).toEqual(['Key item.abcd must be at most 3 characters long']);
    expect(schema().isValid({ abcd: 1 })).toBe(false);
  });

  it('Should not pass the key type to nested schemas built from plain objects', () => {
    const nested = new Schema(
      { inner: { long: Integer({ isMandatory: false }) } },
      { propertyNameType: String({ max: 5 }) }
    );
    expect(nested.validate({ inner: { long: 1, longer: 2 } })).toEqual([]);
  });
});

describe('ArrayOf contains and additionalType', () => {
  it('Should require an element that satisfies contains', () => {
    const type = ArrayOf({ contains: Integer({ min: 5 }) });
    expect(type.validate([1, 7])).toBeUndefined();
    expect(type.validate([1, 2], 'list')).toBe('list must contain at least one matching element');
    expect(type.isValid([])).toBe(false);
  });

  it('Should check the elements after a tuple with additionalType', () => {
    const type = ArrayOf({ type: [Integer(), String()], additionalType: Integer({ min: 0 }) });
    expect(type.validate([1, 'a', 2, 3])).toEqual([]);
    expect(type.validate([1, 'a', -1, 'x'])).toEqual(['Value[2] must be at least 0', 'Value[3] must be a number']);
    expect(type.isValid([1, 'a', -1])).toBe(false);
  });

  it('Should ignore additionalType without a tuple', () => {
    expect(ArrayOf({ type: Integer(), additionalType: String() }).isValid([1, 2])).toBe(true);
  });
});

describe('JSON Schema propertyNames', () => {
  it('Should check every key of objects only', () => {
    expect(errorsOf({ propertyNames: { maxLength: 3 } }, [{ f: 1, foo: 2 }, { fooo: 1 }, [1], 'foooo'])).toEqual([
      [],
      ['Key fooo must be at most 3 characters long'],
      [],
      [],
    ]);
  });

  it('Should name nested keys and work with other key keywords', () => {
    const json = {
      properties: { o: { propertyNames: { pattern: '^a' }, additionalProperties: false, properties: { a: {} } } },
    };
    expect(errorsOf(json, [{ o: { a: 1 } }, { o: { b: 1 } }])).toEqual([
      [],
      ['Key o.b does not match the required pattern', 'Unexpected key: o.b'],
    ]);
  });

  it('Should allow no keys for false', () => {
    expect(errorsOf({ propertyNames: false }, [{}, { a: 1 }])).toEqual([[], ['Key a is not allowed']]);
  });
});

describe('JSON Schema contains', () => {
  it('Should require a matching element in arrays only', () => {
    expect(errorsOf({ contains: { minimum: 5 } }, [[3, 4, 5], [2, 3], [], { a: 1 }])).toEqual([
      [],
      ['Value must contain at least one matching element'],
      ['Value must contain at least one matching element'],
      [],
    ]);
  });

  it('Should check null elements', () => {
    expect(errorsOf({ contains: { type: 'integer' } }, [[null], [null, 1]])).toEqual([
      ['Value must contain at least one matching element'],
      [],
    ]);
    // A schema that ignores null, as minimum does, matches it.
    expect(errorsOf({ contains: { minimum: 5 } }, [[null]])).toEqual([[]]);
  });

  it('Should report contains before the errors of the elements', () => {
    const json = { type: 'object', properties: { l: { contains: { const: 'x' }, items: { type: 'string' } } } };
    expect(errorsOf(json, [{ l: ['a', 'x'] }, { l: ['a', 1] }, { l: ['x', 1] }])).toEqual([
      [],
      ['l must contain at least one matching element'],
      ['l[1] must be a string'],
    ]);
  });
});

describe('JSON Schema additionalItems', () => {
  it('Should check the elements after an items array', () => {
    const json = { items: [{}], additionalItems: { type: 'integer' } };
    expect(
      errorsOf(json, [
        [null, 2, 3],
        [null, 2, 'x', null],
      ])
    ).toEqual([[], ['Value[2] must be a number', 'Value[3] cannot be null']]);
  });

  it('Should forbid extra elements for false', () => {
    const json = { items: [{ type: 'integer' }, { type: 'string' }], additionalItems: false };
    expect(errorsOf(json, [[1, 'a'], [1], [1, 'a', 2]])).toEqual([[], [], ['Value[2] is not allowed']]);
  });

  it('Should be ignored when items is not an array', () => {
    expect(errorsOf({ items: { type: 'integer' }, additionalItems: false }, [[1, 2, 3]])).toEqual([[]]);
    expect(errorsOf({ additionalItems: false }, [[1, 2]])).toEqual([[]]);
  });
});
