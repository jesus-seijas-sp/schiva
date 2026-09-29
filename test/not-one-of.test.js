const {
  Integer,
  Not,
  OneOf,
  String,
  compileJsonSchema,
  fromJsonSchema,
  not,
  oneOf,
  ooneOf,
  onot,
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

describe('Not', () => {
  it('Should reject values that match its type', () => {
    const type = Not({ type: String() });
    expect(type.validate('x')).toBe('Value must not match the excluded schema');
    expect(type.validate(1, 'id')).toBeUndefined();
    expect(type.isValid('x')).toBe(false);
    expect(type.isValid(1)).toBe(true);
  });

  it('Should check presence itself', () => {
    expect(Not({ type: String() }).validate(undefined)).toBe('Value is mandatory');
    expect(Not({ type: String() }).validate(null)).toBe('Value cannot be null');
    expect(onot(String()).validate(undefined)).toBeUndefined();
    expect(not(String(), true, true).validate(null)).toBeUndefined();
    expect(not({ type: String(), isMandatory: false }).isValid(undefined)).toBe(true);
  });
});

describe('OneOf', () => {
  const type = () => OneOf({ types: [Integer({ min: 10 }), Integer({ max: 20 })] });

  it('Should accept values that match exactly one type', () => {
    expect(type().validate(5)).toBeUndefined();
    expect(type().validate(25)).toBeUndefined();
    expect(type().isValid(5)).toBe(true);
  });

  it('Should reject values that match more than one type', () => {
    expect(type().validate(15)).toBe('Value must match exactly one schema, but matches more than one');
    expect(type().isValid(15)).toBe(false);
  });

  it('Should report the errors of every type when none matches', () => {
    expect(type().validate('x', 'n')).toEqual(['n must be a number', 'n must be a number']);
  });

  it('Should never accept values without types', () => {
    expect(OneOf().validate(1)).toBe('Value must match exactly one schema, but matches none');
    expect(OneOf().isValid(1)).toBe(false);
  });

  it('Should build with the short helpers', () => {
    expect(oneOf([Integer(), String()]).isValid(1)).toBe(true);
    expect(ooneOf([Integer(), String()]).isValid(undefined)).toBe(true);
    expect(oneOf({ types: [Integer()], isNullable: true }).isValid(null)).toBe(true);
  });
});

describe('JSON Schema not', () => {
  it('Should reject values valid against the schema', () => {
    expect(errorsOf({ not: { type: 'integer' } }, [1, 'x', 1.5])).toEqual([
      ['Value must not match the excluded schema'],
      [],
      [],
    ]);
  });

  it('Should accept null only when the excluded schema rejects it', () => {
    expect(errorsOf({ not: { type: 'string' } }, [null])).toEqual([[]]);
    expect(errorsOf({ not: { type: ['string', 'null'] } }, [null, 1])).toEqual([['Value cannot be null'], []]);
  });

  it('Should combine with other keywords', () => {
    const json = { type: 'object', properties: { id: { type: 'integer', not: { enum: [0, 13] } } } };
    expect(errorsOf(json, [{ id: 1 }, { id: 13 }, { id: 'x' }])).toEqual([
      [],
      ['id must not match the excluded schema'],
      ['id must be a number'],
    ]);
  });

  it('Should reject every value for not true', () => {
    expect(errorsOf({ not: true }, [1, 'x'])).toEqual([
      ['Value must not match the excluded schema'],
      ['Value must not match the excluded schema'],
    ]);
  });
});

describe('JSON Schema oneOf', () => {
  const json = { oneOf: [{ type: 'integer' }, { minimum: 2 }] };

  it('Should accept values valid against exactly one schema', () => {
    expect(errorsOf(json, [1, 2.5, 'x', null])).toEqual([[], [], [], []]);
  });

  it('Should reject values valid against several schemas or none', () => {
    expect(errorsOf(json, [3, 1.5])).toEqual([
      ['Value must match exactly one schema, but matches more than one'],
      ['Value must be an integer', 'Value must be at least 2'],
    ]);
  });

  it('Should accept null only when exactly one schema accepts it', () => {
    const nulls = { oneOf: [{ type: ['string', 'null'] }, { type: ['integer', 'null'] }] };
    expect(errorsOf(nulls, [null, 'x', 1])).toEqual([['Value cannot be null'], [], []]);
  });

  it('Should name nested fields', () => {
    const nested = {
      type: 'object',
      properties: { a: { oneOf: [{ type: 'string' }, { type: 'integer' }, { minimum: 0 }] } },
    };
    expect(errorsOf(nested, [{ a: 'x' }, { a: 1 }, { a: -1.5 }, { a: true }])).toEqual([
      ['a must match exactly one schema, but matches more than one'],
      ['a must match exactly one schema, but matches more than one'],
      ['a must be a string', 'a must be an integer', 'a must be at least 0'],
      // true is only valid against { minimum: 0 }, which ignores non-numbers.
      [],
    ]);
  });

  it('Should work through references', () => {
    const refs = {
      oneOf: [{ $ref: '#/definitions/text' }, { $ref: '#/definitions/text' }, { type: 'integer' }],
      definitions: { text: { anyOf: [{ $ref: '#/definitions/nullable' }] }, nullable: { type: ['string', 'null'] } },
    };
    // null reaches the same target through both text references: two matches.
    expect(errorsOf(refs, [1, null])).toEqual([[], ['Value cannot be null']]);
  });

  it('Should throw on an empty oneOf', () => {
    expect(() => fromJsonSchema({ oneOf: [] })).toThrow('"oneOf" must be a non-empty array');
  });
});
