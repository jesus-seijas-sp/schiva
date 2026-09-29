// Payloads validated by every validator in the payload benchmarks, valid and invalid.

// 1) moltar/typescript-runtime-type-benchmarks payload (strict: no extra keys).
const moltarSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['number', 'negNumber', 'maxNumber', 'string', 'longString', 'boolean', 'deeplyNested'],
  properties: {
    number: { type: 'number' },
    negNumber: { type: 'number' },
    maxNumber: { type: 'number' },
    string: { type: 'string' },
    longString: { type: 'string' },
    boolean: { type: 'boolean' },
    deeplyNested: {
      type: 'object',
      additionalProperties: false,
      required: ['foo', 'num', 'bool'],
      properties: { foo: { type: 'string' }, num: { type: 'number' }, bool: { type: 'boolean' } },
    },
  },
};
const moltarValid = {
  number: 1,
  negNumber: -1,
  maxNumber: Number.MAX_VALUE,
  string: 'string',
  longString:
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivendum intellegat et qui, ei denique consequuntur vix. Semper aeterno percipit ut his, sea ex utinam referrentur repudiandae. No epicuri hendrerit consetetur sit, sit dicta adipiscing ex, in facete detracto deterruisset duo. Quot populo ad qui. Sit fugit nostrum et. Ad per diam dicant interesset, lorem iusto sensibus ut sed. No dicam aperiam vis. Pri posse graeco definitiones cu, id eam populo quaestio adipiscing, usu quod malorum te. Ex nam agam veri, dicunt efficiantur ad qui, ad legere adversarium sit. Commune platonem mel id, brute adipiscing duo an. Vivendum intellegat et qui, ei denique consequuntur vix. Offendit eleifend moderatius ex vix, quem odio mazim et qui, purto expetendis cotidieque quo cu, veri persius vituperata ei nec. Scripta imperdiet ius ne, pro facer iracundia instructior ex. Ut eam aeque quodsi, vim ex putant vituperatoribus.',
  boolean: true,
  deeplyNested: { foo: 'bar', num: 1, bool: false },
};
const moltarInvalid = { ...moltarValid, deeplyNested: { foo: 'bar', num: '1', bool: false }, extra: 1 };

// 2) Business-like payload: order with nested lines, enums, patterns, ranges, nullable and anyOf.
const orderSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'status', 'customer', 'lines', 'total', 'currency', 'createdAt'],
  properties: {
    id: { type: 'string', pattern: '^ORD-[0-9]{8}$' },
    status: { enum: ['draft', 'placed', 'shipped', 'cancelled'] },
    customer: {
      type: 'object',
      required: ['id', 'email', 'name'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        email: { type: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
        name: { type: 'string', minLength: 1, maxLength: 100 },
        phone: { type: ['string', 'null'], maxLength: 20 },
        tags: { type: 'array', items: { type: 'string' }, uniqueItems: true, maxItems: 10 },
      },
    },
    lines: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sku', 'qty', 'price'],
        properties: {
          sku: { type: 'string', minLength: 3, maxLength: 32 },
          qty: { type: 'integer', minimum: 1, maximum: 1000 },
          price: { type: 'number', exclusiveMinimum: 0 },
          discount: { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] },
        },
      },
    },
    total: { type: 'number', minimum: 0 },
    currency: { const: 'EUR' },
    createdAt: { type: 'string', minLength: 10 },
    notes: { type: ['string', 'null'] },
  },
};
const orderValid = {
  id: 'ORD-00012345',
  status: 'placed',
  customer: { id: 42, email: 'jane@example.com', name: 'Jane Doe', phone: null, tags: ['vip', 'eu'] },
  lines: Array.from({ length: 20 }, (_, i) => ({
    sku: `SKU-${1000 + i}`,
    qty: (i % 5) + 1,
    price: 9.99 + i,
    discount: i % 3 === 0 ? 0.1 : null,
  })),
  total: 1234.5,
  currency: 'EUR',
  createdAt: '2026-09-29T10:00:00Z',
  notes: null,
};
const orderInvalid = JSON.parse(JSON.stringify(orderValid));
orderInvalid.lines[5].qty = 0;
orderInvalid.lines[12].price = '12';
orderInvalid.customer.email = 'nope';

const cases = [
  { name: 'moltar strict · valid', schema: moltarSchema, data: moltarValid, expect: true },
  { name: 'moltar strict · invalid', schema: moltarSchema, data: moltarInvalid, expect: false },
  { name: 'order (20 lines) · valid', schema: orderSchema, data: orderValid, expect: true },
  { name: 'order (20 lines) · invalid', schema: orderSchema, data: orderInvalid, expect: false },
];

// Schema whose compile time is measured.
const compileCase = { name: 'compile order schema', schema: orderSchema };

// Compiles the case's schema, or explains why the validator is skipped for it.
function prepareCase(validator, c) {
  let fn;
  try {
    fn = validator.compile(c.schema);
  } catch (e) {
    return { skipped: `${validator.name}: compile error (${e.message.slice(0, 60)})` };
  }
  const got = !!fn(c.data);
  if (got !== c.expect) {
    return { skipped: `${validator.name}: wrong result (${got})` };
  }
  return { fn };
}

module.exports = {
  cases,
  compileCase,
  prepareCase,
};
