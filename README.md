# schiva

Fast schema validation for JavaScript. Describe data with a small schema DSL or with JSON Schema (draft-07), and
schiva compiles it into a JavaScript function generated for that schema, so validating is several times faster than
walking the schema for every value.

- Passes the whole draft-07 [JSON-Schema-Test-Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite)
  (929 of 929 tests), including `$ref` to other documents.
- Readable error messages with the path of each field: `lines[12].price must be a number`.
- Three modes: every error, the first error only, or just `true`/`false`.
- No dependencies. Unknown or unsupported keywords throw instead of being silently ignored.

```sh
npm install schiva
```

## Quick start

```js
const { ClosedSchema, String, Integer, ArrayOf } = require('schiva');

const person = new ClosedSchema({
  id: String(),
  age: Integer({ min: 18 }),
  tags: ArrayOf({ type: String(), isMandatory: false }),
});

// Compile once, when the program starts:
const validatePerson = person.compile();

validatePerson({ id: 'x', age: 20 }); // []
validatePerson({ id: 1, age: 10, extra: 1 });
// ['id must be a string', 'age must be at least 18', 'Unexpected key: extra']
```

With JSON Schema:

```js
const { compileJsonSchema } = require('schiva');

const validate = compileJsonSchema({
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[A-Z]+$' } },
});

validate({ id: 'AB' }); // []
validate({ id: 'ab' }); // ['id does not match the required pattern']
```

## Modes

`compile(options)` (on schemas and on every type) and `compileJsonSchema(json, options)` return a function:

| Option | The function returns | Use it when |
|---|---|---|
| (none) | every error message, `[]` when valid | messages are shown or logged |
| `{ allErrors: false }` | only the first error message, `[]` when valid | one message is enough; stops at the first failing check |
| `{ errors: false }` | `true` or `false` | only validity matters; builds no messages |

Schemas and types also have `validate(value)`, which checks without compiling (10 to 25 times slower), and
`isValid(value)`.

## Compile once

The compiled function is a snapshot of the schema: changes made to the schema or its types afterwards (such as
`.optional()`, `.nullable()` or setting their fields) are not seen. Compile after building the schema, and compile
again if it changes. Compiling takes about 0.1 ms for a schema of moderate size, so compile when the program starts
(or cache the function), not for every value.

The generated code uses `new Function`, so it does not run where code generation is forbidden (for example with a
strict Content Security Policy).

## Schema DSL

A `Schema` takes an object whose keys are the expected properties. Plain objects inside it become nested schemas.

```js
const { Schema, String, Float, Enum } = require('schiva');

const order = new Schema(
  {
    id: String({ pattern: /^ORD-\d{8}$/ }),
    status: Enum({ options: ['draft', 'placed'] }),
    customer: { name: String({ min: 1 }), email: String({ isMandatory: false }) },
    total: Float({ min: 0 }),
  },
  { isOpen: false }
);
```

Every type takes `isMandatory` (default `true`: `undefined` is an error) and `isNullable` (default `false`: `null` is
an error), and has `.optional()`, `.required()`, `.nullable()` and `.notNull()`.

| Type | Options |
|---|---|
| `String` | `min`, `max` (length), `pattern` (RegExp), `allowEmpty`, `countCodePoints` |
| `Integer`, `Float` | `min`, `max`, `exclusiveMin`, `exclusiveMax`, `multipleOf` |
| `Boolean`, `Any`, `Never` | |
| `Enum` | `options` (strings) |
| `Values`, `Const(value)` | `values`: allowed values, compared deeply |
| `ArrayOf` | `type` (one type, or an array of types for a tuple), `min`, `max`, `unique`, `contains`, `additionalType` |
| `AnyOf`, `AllOf`, `OneOf` | `types` |
| `Not` | `type` |
| `Conditional` | `ifType`, `thenType`, `elseType` |
| `When` | `jsonType` (`object`, `array`, `string`, `number`), `type`: checks only values of that JSON type |
| `Ref` | `target`, for recursive schemas |

Schema options: `isOpen` (default `true`; `ClosedSchema` sets it to `false` and rejects unknown keys),
`additionalType`, `patternTypes` (`[{ pattern, type }]`), `propertyNameType`, `minProperties`, `maxProperties`,
`dependencies` (`[{ key, required: [...] }]` or `[{ key, type }]`), `isMandatory`, `isNullable`.

Short helpers are also exported: `str`, `int`, `float`, `bool`, `arrOf`, `obj`, `any`, `anyOf`, `allOf`, `oneOf`,
`not`, `enumt`, and optional versions prefixed with `o` (`ostr`, `oint`...).

Declared keys are read as own properties only, so `{}.toString` or a key added to `Object.prototype` never counts as
present.

## JSON Schema

`fromJsonSchema(json, options)` converts a JSON Schema (draft-07) into the same types, and
`compileJsonSchema(json, options)` compiles it. Every validation keyword of draft-07 is supported, along with
`definitions` and `$ref` (JSON pointers, `$id` base URIs and anchors, recursive schemas). String lengths count Unicode
code points, as the specification says.

References to other documents resolve against the documents given in `options.schemas`, as `{ uri: schema }` or as an
array of schemas with `$id`. Nothing is loaded from the network, and a reference that cannot be resolved throws when
compiling:

```js
const validateOrder = compileJsonSchema(orderSchema, {
  schemas: { 'https://example.com/schemas/address.json': addressSchema },
});
```

To validate schemas against the draft-07 meta-schema, register it in `schemas` (ajv ships a copy as
`ajv/dist/refs/json-schema-draft-07.json`).

## Types of your own

Classes that extend `ValidateType` (or a built-in type) with their own `validate()` or `isValid()` keep working when
compiled: the generated code calls them for their part of the schema.

## Speed

Compared with ajv and the other validators of
[json-schema-benchmark](https://github.com/ebdrup/json-schema-benchmark), each measurement in its own process
(see `bench/`):

| | schiva | ajv | @exodus/schemasafe |
|---|---|---|---|
| Test suite, tests passed | **929** of 929 | 921 (8 wrong) | 905 |
| Test suite, first error (runs/sec) | **118k** | 62k | 99k |
| Test suite, all errors (runs/sec) | **88k** | 54k | 65k |
| Order with 20 lines, valid, first error (validations/sec) | **2.26M** | 0.76M | 0.54M |
| Order with 20 lines, invalid, all errors (validations/sec) | **1.86M** | 0.43M | 0.32M |
| Compiling a schema (per sec) | **10k** | 0.2k | 0.8k |

```sh
pnpm run bench         # every validator in its own process (about 8 minutes)
pnpm run bench:quick   # every validator in one process (about a minute)
```

## License

MIT
