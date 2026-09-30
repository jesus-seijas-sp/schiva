const { compileJsonSchema, fromJsonSchema, toErrors } = require('../src');

const DRAFT_2019 = 'https://json-schema.org/draft/2019-09/schema';
const DRAFT_2020 = 'https://json-schema.org/draft/2020-12/schema';

// Every compiled mode and the uncompiled type give the same verdict and messages.
function check(schema, value) {
  const errors = compileJsonSchema(schema)(value);
  expect(compileJsonSchema(schema, { allErrors: false })(value)).toEqual(errors.slice(0, 1));
  expect(compileJsonSchema(schema, { errors: false })(value)).toBe(errors.length === 0);
  const type = fromJsonSchema(schema);
  expect(type.isValid(value)).toBe(errors.length === 0);
  expect(errors.length === 0 ? [] : toErrors(type.errors(value))).toEqual(errors);
  return errors;
}

describe('unevaluatedProperties', () => {
  it('Should reject the keys no other keyword evaluates', () => {
    const schema = { $schema: DRAFT_2020, type: 'object', properties: { a: {} }, unevaluatedProperties: false };
    expect(check(schema, { a: 1 })).toEqual([]);
    expect(check(schema, { a: 1, b: 2 })).toEqual(['Unexpected key: b']);
  });

  it('Should check the keys left against a schema', () => {
    const schema = {
      $schema: DRAFT_2020,
      type: 'object',
      properties: { a: {} },
      unevaluatedProperties: { type: 'string' },
    };
    expect(check(schema, { a: 1, b: 'x' })).toEqual([]);
    expect(check(schema, { a: 1, b: 2 })).toEqual(['b must be a string']);
  });

  it('Should see the keys that allOf, $ref and patternProperties evaluate', () => {
    const schema = {
      $schema: DRAFT_2020,
      $defs: { base: { properties: { id: { type: 'integer' } } } },
      $ref: '#/$defs/base',
      allOf: [{ properties: { name: {} } }],
      patternProperties: { '^x-': {} },
      unevaluatedProperties: false,
    };
    expect(check(schema, { id: 1, name: 'a', 'x-tag': 1 })).toEqual([]);
    expect(check(schema, { id: 1, other: 1 })).toEqual(['Unexpected key: other']);
  });

  it('Should only see the keys of the anyOf and oneOf alternatives that match', () => {
    const schema = {
      $schema: DRAFT_2020,
      anyOf: [
        { properties: { a: { const: 1 } }, required: ['a'] },
        { properties: { b: { const: 2 } }, required: ['b'] },
      ],
      unevaluatedProperties: false,
    };
    expect(check(schema, { a: 1, b: 2 })).toEqual([]);
    expect(check(schema, { a: 1, b: 3 })).toEqual(['Unexpected key: b']);
    expect(check({ ...schema, oneOf: schema.anyOf, anyOf: undefined }, { a: 1 })).toEqual([]);
  });

  it('Should not see the keys of alternatives that do not match when they name several keys', () => {
    const card = { properties: { method: { const: 'card' }, card: {}, expiry: {} }, required: ['card'] };
    const transfer = { properties: { method: { const: 'transfer' }, iban: {}, bic: {} }, required: ['iban'] };
    const base = { $schema: DRAFT_2020, properties: { id: {} }, unevaluatedProperties: false };
    const value = { id: 1, method: 'card', card: 'x', expiry: 'y', iban: 'z' };
    expect(check({ ...base, oneOf: [card, transfer] }, value)).toEqual(['Unexpected key: iban']);
    expect(check({ ...base, anyOf: [card, transfer] }, value)).toEqual(['Unexpected key: iban']);
    expect(check({ ...base, if: card, then: { properties: { cvv: {}, pin: {} } } }, { ...value, cvv: 1 })).toEqual([
      'Unexpected key: iban',
    ]);
    const dependent = { ...base, dependentSchemas: { id: { properties: { a: {}, b: {} } } } };
    expect(check(dependent, { id: 1, a: 1, c: 1 })).toEqual(['Unexpected key: c']);
    expect(check({ ...base, oneOf: [card, transfer] }, { id: 1, method: 'card', card: 'x', expiry: 'y' })).toEqual([]);
  });

  it('Should see the keys of if when it matches, and of the branch taken', () => {
    const schema = {
      $schema: DRAFT_2019,
      if: { properties: { kind: { const: 'user' } }, required: ['kind'] },
      then: { properties: { name: {} } },
      else: { properties: { id: {} } },
      unevaluatedProperties: false,
    };
    expect(check(schema, { kind: 'user', name: 'a' })).toEqual([]);
    expect(check(schema, { kind: 'user', id: 1 })).toEqual(['Unexpected key: id']);
    expect(check(schema, { id: 1 })).toEqual([]);
  });

  it('Should see the keys of dependentSchemas when their key is present', () => {
    const schema = {
      $schema: DRAFT_2020,
      properties: { card: {} },
      dependentSchemas: { card: { properties: { cvv: {} } } },
      unevaluatedProperties: false,
    };
    expect(check(schema, { card: 1, cvv: 1 })).toEqual([]);
    expect(check(schema, { cvv: 1 })).toEqual(['Unexpected key: cvv']);
  });

  it('Should not see the keys of not, nor the ones only required names', () => {
    const schema = {
      $schema: DRAFT_2020,
      not: { properties: { a: { const: 0 } } },
      required: ['b'],
      unevaluatedProperties: false,
    };
    expect(check(schema, { a: 1, b: 1 })).toEqual(['Unexpected key: a', 'Unexpected key: b']);
  });

  it('Should count every key as evaluated by additionalProperties, even when it is true', () => {
    expect(check({ $schema: DRAFT_2020, additionalProperties: true, unevaluatedProperties: false }, { a: 1 })).toEqual(
      []
    );
  });

  it('Should see the keys that a nested unevaluatedProperties evaluates', () => {
    const schema = {
      $schema: DRAFT_2020,
      allOf: [{ properties: { a: {} }, unevaluatedProperties: true }],
      unevaluatedProperties: false,
    };
    expect(check(schema, { a: 1, b: 1 })).toEqual([]);
  });

  it('Should check nested objects with their path', () => {
    const schema = {
      $schema: DRAFT_2020,
      properties: { user: { properties: { name: {} }, unevaluatedProperties: false } },
    };
    expect(check(schema, { user: { name: 'a', age: 1 } })).toEqual(['Unexpected key: user.age']);
  });

  it('Should only check objects', () => {
    const schema = { $schema: DRAFT_2020, unevaluatedProperties: false };
    expect(check(schema, [1])).toEqual([]);
    expect(check(schema, 'x')).toEqual([]);
    expect(check(schema, null)).toEqual([]);
  });
});

describe('unevaluatedItems', () => {
  it('Should reject the elements after prefixItems', () => {
    const schema = { $schema: DRAFT_2020, prefixItems: [{ type: 'string' }], unevaluatedItems: false };
    expect(check(schema, ['a'])).toEqual([]);
    expect(check(schema, ['a', 1])).toEqual(['Value[1] is not allowed']);
  });

  it('Should check the elements left against a schema', () => {
    const schema = { $schema: DRAFT_2020, prefixItems: [{ type: 'string' }], unevaluatedItems: { type: 'integer' } };
    expect(check(schema, ['a', 1, 'b'])).toEqual(['Value[2] must be a number']);
  });

  it('Should count every element as evaluated by items', () => {
    expect(check({ $schema: DRAFT_2020, items: true, unevaluatedItems: false }, [1, 2])).toEqual([]);
    expect(check({ $schema: DRAFT_2019, items: [{}], additionalItems: true, unevaluatedItems: false }, [1, 2])).toEqual(
      []
    );
  });

  it('Should see the elements that allOf and anyOf evaluate', () => {
    const schema = {
      $schema: DRAFT_2020,
      allOf: [{ prefixItems: [{}] }],
      anyOf: [{ prefixItems: [{}, { const: 'b' }] }, { prefixItems: [{}, {}, { const: 'c' }] }],
      unevaluatedItems: false,
    };
    expect(check(schema, [1, 'b'])).toEqual([]);
    expect(check(schema, [1, 'x', 'c'])).toEqual([]);
    expect(check(schema, [1, 'b', 'x'])).toEqual(['Value[2] is not allowed']);
  });

  it('Should see the elements that contains matches in 2020-12, and not in 2019-09', () => {
    const schema = { contains: { type: 'string' }, unevaluatedItems: false };
    expect(check({ ...schema, $schema: DRAFT_2020 }, ['a', 'b'])).toEqual([]);
    expect(check({ ...schema, $schema: DRAFT_2020 }, ['a', 1])).toEqual(['Value[1] is not allowed']);
    expect(check({ ...schema, $schema: DRAFT_2019 }, ['a'])).toEqual(['Value[0] is not allowed']);
  });

  it('Should see the elements that a lone if evaluates', () => {
    const schema = { $schema: DRAFT_2020, if: { prefixItems: [{ const: 'a' }] }, unevaluatedItems: false };
    expect(check(schema, ['a'])).toEqual([]);
    expect(check(schema, ['b'])).toEqual(['Value[0] is not allowed']);
  });

  it('Should see the elements of a $ref next to it, and stop at reference cycles', () => {
    const schema = {
      $schema: DRAFT_2020,
      $defs: { pair: { prefixItems: [{}, {}] } },
      $ref: '#/$defs/pair',
      unevaluatedItems: false,
    };
    expect(check(schema, [1, 2])).toEqual([]);
    expect(check(schema, [1, 2, 3])).toEqual(['Value[2] is not allowed']);
    const tree = {
      $schema: DRAFT_2020,
      $defs: { node: { prefixItems: [{ type: 'integer' }], items: { $ref: '#/$defs/node' } } },
      $ref: '#/$defs/node',
      unevaluatedItems: false,
    };
    expect(check(tree, [1, [2]])).toEqual([]);
  });
});
