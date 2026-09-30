const {
  AllOf,
  AnyOf,
  ArrayOf,
  ClosedSchema,
  Conditional,
  Integer,
  Not,
  Obj,
  OneOf,
  Ref,
  Schema,
  String,
  When,
  arrOf,
  oarrOf,
  obj,
  oobj,
} = require('../src');

// A plain object where a type is expected stands for new Schema(object), as it does for a key of a Schema.
describe('Plain objects as types', () => {
  const line = { sku: String(), qty: Integer({ min: 1 }) };
  const value = [
    { sku: 'a', qty: 1 },
    { sku: 2, qty: 0 },
  ];
  const expected = ['Value[1].sku must be a string', 'Value[1].qty must be at least 1'];

  it('Should convert the type of ArrayOf into a Schema', () => {
    const type = ArrayOf({ type: line });
    expect(type.type).toBeInstanceOf(Schema);
    expect(type.compile()(value)).toEqual(expected);
    expect(type.compile({ allErrors: false })(value)).toEqual([expected[0]]);
    expect(type.compile({ errors: false })(value)).toBe(false);
    expect(type.isValid([{ sku: 'a', qty: 1 }])).toBe(true);
    expect(type.isValid(value)).toBe(false);
    expect(type.validate(value).flat(Infinity)).toEqual(expected);
  });

  it('Should convert them in the short helpers', () => {
    expect(arrOf(line).compile()(value)).toEqual(expected);
    expect(oarrOf(line).compile()(undefined)).toEqual([]);
    expect(arrOf({ type: line, min: 3 }).compile()(value)).toContain('Value must have at least 3 elements');
  });

  it('Should take a type as the first argument of arrOf', () => {
    expect(arrOf(String()).compile()([1])).toEqual(['Value[0] must be a string']);
    expect(oarrOf(String()).compile()([1])).toEqual(['Value[0] must be a string']);
    expect(arrOf(new Schema(line)).compile()(value)).toEqual(expected);
    expect(arrOf(Integer(), 2).compile()([1])).toEqual(['Value must have at least 2 elements']);
    expect(arrOf({}).compile()([1])).toEqual([]);
  });

  it('Should report the path of the field inside a Schema', () => {
    const order = new Schema({ lines: ArrayOf({ type: line }) });
    expect(order.compile()({ lines: value })).toEqual([
      'lines[1].sku must be a string',
      'lines[1].qty must be at least 1',
    ]);
  });

  it('Should keep the converted schema open, as new Schema(object) is', () => {
    const order = new ClosedSchema({ lines: ArrayOf({ type: line }) });
    expect(order.compile()({ lines: [{ sku: 'a', qty: 1, note: 'x' }] })).toEqual([]);
    const closed = new ClosedSchema({ lines: ArrayOf({ type: new ClosedSchema(line) }) });
    expect(closed.compile()({ lines: [{ sku: 'a', qty: 1, note: 'x' }] })).toEqual(['Unexpected key: lines[0].note']);
  });

  it('Should convert tuples, contains and additionalType of ArrayOf', () => {
    const type = ArrayOf({ type: [{ a: String() }], additionalType: { b: String() }, contains: { a: String() } });
    const validate = type.compile();
    expect(validate([{ a: 'x' }, { b: 'y' }])).toEqual([]);
    expect(validate([{ a: 'x' }, { b: 1 }])).toEqual(['Value[1].b must be a string']);
    expect(validate([{ a: 1 }])).toEqual(['Value must contain at least one matching element']);
  });

  it('Should convert the types of AnyOf, AllOf and OneOf', () => {
    expect(AnyOf({ types: [{ a: String() }, { b: String() }] }).compile({ errors: false })({ b: 'x' })).toBe(true);
    expect(AllOf({ types: [{ a: String() }, { b: String() }] }).compile()({ a: 'x' })).toEqual(['b is mandatory']);
    expect(OneOf({ types: [{ a: String() }, { b: String() }] }).compile({ errors: false })({ a: 'x' })).toBe(true);
  });

  it('Should convert the types of Not, Conditional, When and Ref', () => {
    expect(Not({ type: { a: String() } }).compile({ errors: false })({ a: 'x' })).toBe(false);
    const conditional = Conditional({
      ifType: { kind: String() },
      thenType: { name: String() },
      elseType: { id: Integer() },
    });
    expect(conditional.compile()({ kind: 'user' })).toEqual(['name is mandatory']);
    expect(conditional.compile()({})).toEqual(['id is mandatory']);
    expect(When({ jsonType: 'object', type: { a: String() } }).compile()({ a: 1 })).toEqual(['a must be a string']);
    expect(Ref({ target: { a: String() } }).compile()({ a: 1 })).toEqual(['a must be a string']);
  });

  it('Should convert the types in the options of a Schema', () => {
    const schema = new Schema(
      {},
      {
        additionalType: { a: String() },
        patternTypes: [{ pattern: /^x-/, type: { b: String() } }],
        dependencies: [{ key: 'id', type: { name: String() } }],
      }
    );
    const validate = schema.compile();
    expect(validate({ other: { a: 1 } })).toEqual(['other.a must be a string']);
    expect(validate({ 'x-1': { b: 1 } })).toEqual(['x-1.b must be a string']);
    expect(validate({ id: { a: 'x' } })).toContain('name is mandatory');
  });

  it('Should throw when the type is not a type or an object of types', () => {
    expect(() => ArrayOf({ type: 'string' })).toThrow('ArrayOf type must be a type or an object of types');
    expect(() => ArrayOf({ type: [String(), 3] })).toThrow('ArrayOf type[1] must be a type or an object of types');
    expect(() => AnyOf({ types: String() })).toThrow('AnyOf types must be an array of types');
    expect(() => Not({ type: null })).toThrow('Not type must be a type or an object of types');
    expect(() => new Schema({}, { additionalType: true })).toThrow(
      'Schema additionalType must be a type or an object of types'
    );
  });
});

describe('Obj and obj()', () => {
  it('Should check the shape given as schema, compiled or not', () => {
    const type = Obj({ schema: { a: Integer() } });
    expect(type.compile()({ a: 'x' })).toEqual(['a must be a number']);
    expect(type.validate({ a: 1 })).toEqual([]);
    expect(Obj().compile()('x')).toEqual(['Value must be an object']);
  });

  it('Should take a shape or the options in obj() and oobj()', () => {
    expect(obj({ a: Integer() }).compile()({ a: 'x' })).toEqual(['a must be a number']);
    expect(obj({ schema: { a: Integer() }, isNullable: true }).compile()(null)).toEqual([]);
    expect(oobj({ a: Integer() }).compile()(undefined)).toEqual([]);
    expect(new Schema({ inner: obj({ a: Integer() }) }).compile()({ inner: { a: 'x' } })).toEqual([
      'inner.a must be a number',
    ]);
  });
});
