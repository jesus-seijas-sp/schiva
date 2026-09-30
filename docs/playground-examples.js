// The examples of the playground (playground.html). Each one has:
// - language: 'js' (the schema is JavaScript that defines `schema` with the DSL) or 'json' (a JSON Schema);
// - schema, value and options: the text of the three editors (value and options are JavaScript expressions);
// - hint: what to try with it.
window.PLAYGROUND_EXAMPLES = [
  {
    id: 'first-schema',
    group: 'Schema DSL (JavaScript)',
    title: 'A first schema',
    language: 'js',
    hint: 'Change id to "u1" and age to 20, and remove extra: the value becomes valid.',
    schema: `// Every name of schiva is available here, as after
// import { ClosedSchema, String, ... } from 'schiva'.
// Define \`schema\`: the playground compiles it.

const schema = new ClosedSchema({
  id: String(),
  age: Integer({ min: 18 }),
  tags: ArrayOf({ type: String(), isMandatory: false }),
});`,
    value: `{ id: 1, age: 10, extra: 1 }`,
    options: `{}`,
  },
  {
    id: 'nested',
    group: 'Schema DSL (JavaScript)',
    title: 'Nested objects and arrays',
    language: 'js',
    hint: 'Each error names where it is: lines[1].qty, customer.name... Fix them one by one.',
    schema: String.raw`const schema = new ClosedSchema({
  id: String({ pattern: /^ORD-\d{4}$/ }),
  customer: {
    name: String({ min: 1 }),
    email: String({ format: 'email', isMandatory: false }),
  },
  lines: ArrayOf({
    type: { sku: String(), qty: Integer({ min: 1 }), price: Float({ min: 0 }) },
    min: 1,
  }),
});`,
    value: `{
  id: 'ORD-12',
  customer: { name: '', email: 'ann@example.com' },
  lines: [
    { sku: 'A-1', qty: 2, price: 9.5 },
    { sku: 'B-2', qty: 0, price: -1 },
  ],
}`,
    options: `{}`,
  },
  {
    id: 'optional',
    group: 'Schema DSL (JavaScript)',
    title: 'Optional, nullable and choices',
    language: 'js',
    hint: 'nickname can be left out, deletedAt can be null, and status must be one of the options.',
    schema: `const schema = new Schema({
  name: String({ min: 1, max: 40 }),
  nickname: String({ isMandatory: false }),
  status: Enum({ options: ['active', 'blocked'] }),
  deletedAt: String({ format: 'date-time', isNullable: true }),
  score: Float({ min: 0, max: 1 }).optional(),
});`,
    value: `{ name: 'Ann', status: 'pending', deletedAt: null, score: 1.5 }`,
    options: `{}`,
  },
  {
    id: 'recursive',
    group: 'Schema DSL (JavaScript)',
    title: 'A recursive tree',
    language: 'js',
    hint: 'A Ref points back to the schema, so children can nest at any depth.',
    schema: `const child = Ref();
const schema = new Schema({
  value: Integer(),
  children: ArrayOf({ type: child, isMandatory: false }),
});
child.target = schema;`,
    value: `{
  value: 1,
  children: [
    { value: 2 },
    { value: 3, children: [{ value: 'x' }] },
  ],
}`,
    options: `{}`,
  },
  {
    id: 'request',
    group: 'JSON Schema',
    title: 'An API request body',
    language: 'json',
    hint: 'required lists the mandatory keys, and additionalProperties: false rejects the others.',
    schema: `{
  "type": "object",
  "required": ["email", "password"],
  "additionalProperties": false,
  "properties": {
    "email": { "type": "string", "maxLength": 100 },
    "password": { "type": "string", "minLength": 8 },
    "remember": { "type": "boolean" }
  }
}`,
    value: `{ "email": "ann@example.com", "password": "1234", "admin": true }`,
    options: `{}`,
  },
  {
    id: 'formats',
    group: 'JSON Schema',
    title: 'Formats: email, date, uri...',
    language: 'json',
    hint: 'format checks nothing by default, as the standard says; the option formats: true turns the checks on. Try formats: false.',
    schema: `{
  "type": "object",
  "properties": {
    "email": { "type": "string", "format": "email" },
    "birthday": { "type": "string", "format": "date" },
    "website": { "type": "string", "format": "uri" },
    "id": { "type": "string", "format": "uuid" }
  }
}`,
    value: `{
  "email": "ann@",
  "birthday": "2026-02-30",
  "website": "example.com",
  "id": "0b4a7c1e-1d2f-4e5a-9b8c-7d6e5f4a3b2c"
}`,
    options: `{ formats: true }`,
  },
  {
    id: 'conditional',
    group: 'JSON Schema',
    title: 'Rules that depend on a value (if/then)',
    language: 'json',
    hint: 'The postal code pattern depends on the country. Try "country": "US" with "postalCode": "12345".',
    schema: String.raw`{
  "type": "object",
  "required": ["country", "postalCode"],
  "properties": {
    "country": { "enum": ["US", "ES", "NL"] },
    "postalCode": { "type": "string" }
  },
  "if": { "properties": { "country": { "const": "US" } } },
  "then": { "properties": { "postalCode": { "pattern": "^\\d{5}$" } } },
  "else": { "properties": { "postalCode": { "pattern": "^[0-9A-Z ]{4,7}$" } } }
}`,
    value: `{ "country": "US", "postalCode": "1234 AB" }`,
    options: `{}`,
  },
  {
    id: 'refs',
    group: 'JSON Schema',
    title: 'Reusing schemas with $ref',
    language: 'json',
    hint: '$defs holds schemas that $ref reuses: both addresses are checked with the same one.',
    schema: `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$defs": {
    "address": {
      "type": "object",
      "required": ["street", "city"],
      "properties": {
        "street": { "type": "string" },
        "city": { "type": "string" }
      }
    }
  },
  "type": "object",
  "properties": {
    "billing": { "$ref": "#/$defs/address" },
    "shipping": { "$ref": "#/$defs/address" }
  }
}`,
    value: `{
  "billing": { "street": "Main St 1", "city": "Springfield" },
  "shipping": { "street": 42 }
}`,
    options: `{}`,
  },
  {
    id: 'discriminator',
    group: 'JSON Schema',
    title: 'OpenAPI: oneOf with a discriminator',
    language: 'json',
    hint: 'petType picks the schema, so the errors are the ones of that schema. Try "petType": "dog", or "cow".',
    schema: `{
  "$defs": {
    "Cat": {
      "type": "object",
      "required": ["petType", "lives"],
      "properties": { "petType": { "type": "string" }, "lives": { "type": "integer", "maximum": 9 } }
    },
    "Dog": {
      "type": "object",
      "required": ["petType", "bark"],
      "properties": { "petType": { "type": "string" }, "bark": { "type": "boolean" } }
    }
  },
  "oneOf": [{ "$ref": "#/$defs/Cat" }, { "$ref": "#/$defs/Dog" }],
  "discriminator": {
    "propertyName": "petType",
    "mapping": { "cat": "#/$defs/Cat", "dog": "#/$defs/Dog" }
  }
}`,
    value: `{ "petType": "cat", "lives": 12 }`,
    options: `{}`,
  },
  {
    id: 'unevaluated',
    group: 'JSON Schema',
    title: '2020-12: unevaluatedProperties',
    language: 'json',
    hint: 'unevaluatedProperties: false rejects the keys that no part of the schema declares, even through allOf.',
    schema: `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "allOf": [
    { "type": "object", "properties": { "id": { "type": "integer" } }, "required": ["id"] },
    { "properties": { "name": { "type": "string" } } }
  ],
  "unevaluatedProperties": false
}`,
    value: `{ "id": 1, "name": "Ann", "nmae": "typo" }`,
    options: `{}`,
  },
  {
    id: 'defaults',
    group: 'Options',
    title: 'Defaults and removing keys',
    language: 'json',
    hint: 'useDefaults fills role, and removeAdditional removes password instead of reporting it. See the value after validating.',
    schema: `{
  "type": "object",
  "required": ["name"],
  "additionalProperties": false,
  "properties": {
    "name": { "type": "string" },
    "role": { "type": "string", "default": "user" }
  }
}`,
    value: `{ "name": "Ann", "password": "secret" }`,
    options: `{ useDefaults: true, removeAdditional: true }`,
  },
  {
    id: 'coerce',
    group: 'Options',
    title: 'Converting query strings',
    language: 'json',
    hint: 'Query strings are all text: coerceTypes converts "2" to 2 and "true" to true. "ten" cannot be converted.',
    schema: `{
  "type": "object",
  "properties": {
    "page": { "type": "integer", "minimum": 1 },
    "size": { "type": "integer", "maximum": 100 },
    "archived": { "type": "boolean" }
  }
}`,
    value: `{ "page": "2", "size": "ten", "archived": "true" }`,
    options: `{ coerceTypes: true }`,
  },
  {
    id: 'keywords',
    group: 'Options',
    title: 'Custom keywords and ajv-keywords',
    language: 'json',
    hint: 'The options define "even", and ajvKeywords() adds the keywords of ajv-keywords, like range.',
    schema: `{
  "type": "object",
  "properties": {
    "seats": { "type": "integer", "even": true },
    "floor": { "type": "integer", "range": [0, 20] }
  }
}`,
    value: `{ "seats": 3, "floor": 25 }`,
    options: `{
  keywords: [
    {
      keyword: 'even',
      type: 'integer',
      validate: (value, data) => !value || data % 2 === 0,
      message: 'must be even',
    },
    ...ajvKeywords(['range']),
  ],
}`,
  },
  {
    id: 'draft-04',
    group: 'JSON Schema',
    title: 'An old draft-04 schema',
    language: 'json',
    hint: 'In draft-04, exclusiveMinimum is a boolean next to minimum. schiva reads the draft from $schema.',
    schema: `{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "price": { "type": "number", "minimum": 0, "exclusiveMinimum": true },
    "currency": { "type": "string", "enum": ["EUR", "USD"] }
  },
  "required": ["price", "currency"]
}`,
    value: `{ "price": 0, "currency": "GBP" }`,
    options: `{}`,
  },
];
