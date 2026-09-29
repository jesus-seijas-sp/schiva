const {
  AllOf,
  Any,
  AnyOf,
  ArrayOf,
  Boolean,
  ClosedSchema,
  Conditional,
  Enum,
  Float,
  Integer,
  Never,
  Not,
  Obj,
  OneOf,
  Ref,
  Schema,
  String,
  Values,
  ValidateType,
  When,
} = require('../../src');

// Custom type that only overrides validate(); returns one message or an array of messages.
class CheckType extends ValidateType {
  constructor(check, message, asArray = false) {
    super();
    this.check = check;
    this.message = message;
    this.asArray = asArray;
  }

  validate(value, fieldName = 'Value') {
    if (this.check(value)) {
      return undefined;
    }
    const error = `${fieldName} ${this.message}`;
    return this.asArray ? [error] : error;
  }
}

const samples = [
  undefined,
  null,
  0,
  -0,
  1,
  -1,
  1.5,
  18,
  100,
  NaN,
  Infinity,
  '',
  'a',
  'abc',
  'abcdefghijk',
  'ABC',
  '\u{1F4A9}',
  '\u{1F4A9}\u{1F4A9}',
  'a\uD83D',
  true,
  false,
  [],
  [1],
  [1, 1],
  [1, 2, 3],
  ['a', 'b'],
  [{ a: 1 }, { a: 1 }],
  [{ id: 'x', age: 20 }, { id: 1 }],
  {},
  { a: 1 },
  { id: 'x', age: 20 },
  { id: 'x', age: 20, extra: true },
  { id: 'x', age: 10 },
  { id: 1 },
  { id: 'x', inner: { age: 1 } },
  { id: 'x', inner: { age: 'old' } },
  { id: 'x', inner: null },
  { id: 'a', children: [{ id: 'b', children: [] }, { id: 1, children: [{}] }, null] },
  Object.create({ id: 'x', age: 20 }),
  { constructor: 'x', toString: 1 },
  { id: 1, age: 'x', extra: 1, inner: { age: 'y' } },
  [{ id: 1, age: 1 }, { id: 'x' }, 'x', { id: 2, age: null }],
  { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 },
  { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11 },
];

// Tree whose children are trees, through a reference to itself.
function tree() {
  const node = new Schema({ id: String(), children: ArrayOf({ isMandatory: false }) });
  node.schema.children.type = Ref({ target: node });
  return node;
}

const tenKeys = Object.fromEntries('abcdefghij'.split('').map((key) => [key, Integer()]));

// Every built-in type, with the options that change what isValid has to check.
const types = {
  Any: () => Any(),
  'Any optional nullable': () => Any({ isMandatory: false, isNullable: true }),
  Boolean: () => Boolean(),
  'Boolean optional': () => Boolean({ isMandatory: false }),
  Float: () => Float(),
  'Float bounded': () => Float({ min: 0, max: 18 }),
  'Float exclusive': () => Float({ exclusiveMin: 0, exclusiveMax: 18 }),
  'Float multipleOf': () => Float({ multipleOf: 1.5 }),
  'Integer multipleOf': () => Integer({ multipleOf: 2, min: 0 }),
  'Float infinite bound': () => Float({ max: Infinity }),
  Integer: () => Integer(),
  'Integer bounded nullable': () => Integer({ min: 1, max: 99, isNullable: true }),
  String: () => String(),
  'String bounded': () => String({ min: 2, max: 10 }),
  'String optional min': () => String({ min: 2, isMandatory: false }),
  'String allowEmpty false': () => String({ min: 2, isMandatory: false, allowEmpty: false }),
  'String code points': () => String({ min: 2, max: 2, countCodePoints: true }),
  'Schema with Object.prototype keys': () =>
    new Schema({ constructor: String(), toString: Integer({ isMandatory: false }) }),
  'String pattern': () => String({ pattern: /^[a-z]+$/ }),
  Enum: () => Enum({ options: ['a', 'abc'] }),
  Values: () => Values({ values: [1, 'a', [1, 2, 3], { a: 1 }] }),
  'Values NaN': () => Values({ values: [NaN] }),
  'Values mixed': () => Values({ values: [true, null, undefined, -0, 'abc'] }),
  'Values none': () => Values({ values: [] }),
  ArrayOf: () => ArrayOf(),
  'ArrayOf bounded': () => ArrayOf({ min: 1, max: 2 }),
  'ArrayOf typed': () => ArrayOf({ type: Integer() }),
  'ArrayOf tuple': () => ArrayOf({ type: [Integer(), String()] }),
  'ArrayOf contains': () => ArrayOf({ contains: Integer({ min: 2 }), max: 3 }),
  'ArrayOf tuple with additionalType': () => ArrayOf({ type: [Integer()], additionalType: Integer({ max: 2 }) }),
  'ArrayOf unique': () => ArrayOf({ unique: true }),
  'ArrayOf of Schema': () => ArrayOf({ type: new Schema({ id: String(), age: Integer({ min: 18 }) }) }),
  AllOf: () => AllOf({ types: [Float({ min: 0 }), Integer({ max: 18 })] }),
  'AllOf empty': () => AllOf({ types: [] }),
  'AllOf of Schema': () => AllOf({ types: [new Schema({ id: String() }), new Schema({ age: Integer() })] }),
  AnyOf: () => AnyOf({ types: [String({ min: 2 }), Integer()] }),
  'AnyOf empty': () => AnyOf({ types: [] }),
  'AnyOf undefined types': () => AnyOf(),
  'AnyOf nested': () => AnyOf({ types: [AnyOf({ types: [Integer({ min: 18 }), Boolean()] }), ArrayOf()] }),
  Obj: () => Obj({ schema: new Schema({ id: String() }) }),
  'Obj without schema': () => Obj(),
  Schema: () => new Schema({ id: String(), age: Integer({ min: 18 }) }),
  'Schema optional nullable': () => new Schema({ id: String() }, { isMandatory: false, isNullable: true }),
  'Schema closed': () => new ClosedSchema({ id: String(), age: Integer({ min: 18 }) }),
  'Schema closed with many keys': () => new ClosedSchema({ ...tenKeys }),
  'Schema patternTypes': () =>
    new ClosedSchema(
      { id: String() },
      {
        patternTypes: [
          { pattern: /^[a-c]$/, type: Integer() },
          { pattern: /a/, type: Float({ min: 1 }) },
        ],
      }
    ),
  'Schema propertyNameType': () =>
    new Schema({ id: String({ isMandatory: false }) }, { propertyNameType: String({ max: 2 }) }),
  'Schema additionalType': () => new Schema({ id: String() }, { additionalType: Integer() }),
  'Schema property counts': () => new Schema({}, { minProperties: 1, maxProperties: 2 }),
  'Schema nested': () => new Schema({ id: String(), inner: { age: Integer() } }),
  'When string': () => When({ jsonType: 'string', type: String({ min: 2, isMandatory: false, isNullable: true }) }),
  'When number mandatory': () => When({ jsonType: 'number', type: Integer({ min: 18 }) }),
  'When array': () => When({ jsonType: 'array', type: ArrayOf({ type: Integer(), max: 2 }), isMandatory: false }),
  'When object in Schema': () =>
    new Schema({ inner: When({ jsonType: 'object', type: new Schema({ age: Integer() }), isNullable: true }) }),
  Never: () => Never(),
  'Never optional nullable': () => Never({ isMandatory: false, isNullable: true }),
  'Schema with forbidden key': () =>
    new Schema({ id: Never({ isMandatory: false }), age: Integer({ isMandatory: false }) }),
  Conditional: () => Conditional({ ifType: Integer(), thenType: Integer({ min: 10 }), elseType: String({ min: 2 }) }),
  'Conditional without else': () => Conditional({ ifType: String(), thenType: String({ max: 3 }), isNullable: true }),
  'Schema dependencies': () =>
    new Schema(
      { id: String({ isMandatory: false }) },
      {
        dependencies: [
          { key: 'id', required: ['age'] },
          { key: 'a', type: new Schema({ b: Integer({ max: 5 }) }) },
        ],
      }
    ),
  Not: () => Not({ type: Integer({ min: 18 }) }),
  'Not of Schema': () => Not({ type: new Schema({ id: String() }), isNullable: true }),
  OneOf: () => OneOf({ types: [Integer({ min: 10 }), Integer({ max: 20 }), String({ min: 2 })] }),
  'OneOf empty': () => OneOf(),
  'OneOf of Schemas': () => OneOf({ types: [new Schema({ id: String() }), new Schema({ age: Integer() })] }),
  Ref: () => Ref({ target: Integer({ min: 18 }) }),
  'Ref optional to nullable': () => Ref({ target: String({ isNullable: true }), isMandatory: false }),
  'Ref recursive tree': () => tree(),
  'Custom type': () => new CheckType((value) => value === 1 || value === 'a', 'must be 1 or a'),
  'Custom type in Schema': () => new Schema({ id: new CheckType((value) => value === 'x', 'must be x', true) }),
};

module.exports = {
  CheckType,
  samples,
  types,
};
