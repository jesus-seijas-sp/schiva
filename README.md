# schiva

[![npm](https://img.shields.io/npm/v/schiva.svg)](https://www.npmjs.com/package/schiva)
[![CI](https://github.com/jesus-seijas-sp/schiva/actions/workflows/ci.yml/badge.svg)](https://github.com/jesus-seijas-sp/schiva/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

Fast schema validation for JavaScript. Describe data with a small schema DSL or with JSON Schema (draft-07), and
schiva compiles it into a JavaScript function generated for that schema, so validating is several times faster than
walking the schema for every value.

**Documentation: [schiva.js.org](https://schiva.js.org)**

## Contents

- [Features](#features)
- [Install](#install)
- [Getting started](#getting-started)
- [Modes](#modes)
- [Compile once](#compile-once)
- [Schema DSL](#schema-dsl)
- [JSON Schema](#json-schema)
- [Errors](#errors)
- [Types of your own](#types-of-your-own)
- [Security considerations](#security-considerations)
- [Performance](#performance)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Two schema languages, one engine**: a small DSL (`String()`, `Integer({ min: 18 })`...) and JSON Schema draft-07
  compile to the same types and the same generated code.
- **Complete draft-07**: passes the whole [JSON-Schema-Test-Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite)
  for draft-07 (929 of 929 tests), including `$ref` with JSON pointers, `$id` base URIs, anchors, recursive schemas
  and references to other documents.
- **Readable errors** with the path of each field: `lines[12].price must be a number`.
- **Three modes**: every error, the first error only, or just `true`/`false`.
- **Fast**: faster than ajv in every [benchmark](#performance) we run, and about 50 times faster at compiling.
- **Strict**: unknown or unsupported keywords throw when compiling instead of being silently ignored.
- **No dependencies**, CommonJS and ESM, Node.js 18 and later, and browsers through any bundler.
- **Extensible**: classes of your own with a `validate()` method work inside compiled schemas.

## Install

```sh
npm install schiva
```

## Getting started

With the schema DSL:

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
import { compileJsonSchema } from 'schiva';

const validate = compileJsonSchema({
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: '^[A-Z]+$' } },
});

validate({ id: 'AB' }); // []
validate({ id: 'ab' }); // ['id does not match the required pattern']
```

`require('schiva')` and `import { ... } from 'schiva'` export the same names.

## Modes

`compile(options)` (on schemas and on every type) and `compileJsonSchema(json, options)` return a function:

| Option | The function returns | Use it when |
|---|---|---|
| (none) | every error message, `[]` when valid | messages are shown or logged |
| `{ allErrors: false }` | only the first error message, `[]` when valid | one message is enough; stops at the first failing check |
| `{ errors: false }` | `true` or `false` | only validity matters; builds no messages |

```js
const isPerson = person.compile({ errors: false });

if (!isPerson(body)) {
  // reject the request
}
```

Schemas and types also have `validate(value)`, which checks without compiling (10 to 25 times slower), and
`isValid(value)`.

## Compile once

The compiled function is a snapshot of the schema: changes made to the schema or its types afterwards (such as
`.optional()`, `.nullable()` or setting their fields) are not seen. Compile after building the schema, and compile
again if it changes. Compiling takes about 0.1 ms for a schema of moderate size, so compile when the program starts
(or cache the function), not for every value.

```js
// Good: compiled once, reused for every request.
const validateOrder = orderSchema.compile();
app.post('/orders', (req, res) => {
  const errors = validateOrder(req.body);
  if (errors.length) return res.status(400).json({ errors });
  // ...
});
```

The generated code uses `new Function`, so it does not run where code generation is forbidden (for example with a
strict Content Security Policy). See [Security considerations](#security-considerations).

## Schema DSL

A `Schema` takes an object whose keys are the expected properties. Plain objects inside it become nested schemas.

```js
const { Schema, String, Float, Enum, ArrayOf, Integer } = require('schiva');

const order = new Schema(
  {
    id: String({ pattern: /^ORD-\d{8}$/ }),
    status: Enum({ options: ['draft', 'placed'] }),
    customer: { name: String({ min: 1 }), email: String({ isMandatory: false }) },
    lines: ArrayOf({ type: { sku: String(), qty: Integer({ min: 1 }) }, min: 1 }),
    total: Float({ min: 0 }),
  },
  { isOpen: false }
);
```

Wherever a type is expected (`ArrayOf`, `AnyOf`, `Not`, `additionalType`...), a plain object stands for
`new Schema(object)`, as `lines` shows above. That schema is open even inside a `ClosedSchema`; write
`new ClosedSchema({ ... })` to reject unknown keys there too. A value that is neither a type nor an object of types
throws when the type is built.

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
`not`, `enumt`, and optional versions prefixed with `o` (`ostr`, `oint`...). `arrOf(String())` and
`arrOf({ sku: String() })` take the type of the elements; `arrOf({ type, min, ... })` takes the options.

Declared keys are read as own properties only, so `{}.toString` or a key added to `Object.prototype` never counts as
present.

### Recursive schemas

Create the `Ref` first and point it at the schema once the schema exists:

```js
const { Schema, Integer, ArrayOf, Ref } = require('schiva');

const child = Ref();
const node = new Schema({ value: Integer(), children: ArrayOf({ type: child, isMandatory: false }) });
child.target = node;

node.compile()({ value: 1, children: [{ value: 2, children: [{ value: 'x' }] }] });
// ['children[0].children[0].value must be a number']
```

## JSON Schema

`fromJsonSchema(json, options)` converts a JSON Schema (draft-07) into the same types, and
`compileJsonSchema(json, options)` compiles it. Every validation keyword of draft-07 is supported, along with
`definitions` and `$ref` (JSON pointers, `$id` base URIs and anchors, recursive schemas). String lengths count Unicode
code points, as the specification says.

A keyword schiva does not know throws when compiling, with the place where it was found:

```js
compileJsonSchema({ type: 'string', maxLenght: 10 });
// Error: Unsupported JSON Schema keyword "maxLenght" at #
```

Annotations (`title`, `description`, `default`, `examples`, `$comment`, `readOnly`, `writeOnly`, `deprecated`) are
accepted and ignored. So is **`format`**: draft-07 makes checking it optional, and schiva does not check it. Use
`pattern`, or a [type of your own](#types-of-your-own), for values such as emails or dates.

### Several documents

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

## Errors

Errors are plain strings that start with the path of the field, so they can be logged or returned as they are:

```js
[
  'customer.name is mandatory',
  'lines[1].sku must be a string',
  'lines[1].price must be at least 0',
  'Unexpected key: extra',
];
```

A value checked on its own (not inside a schema) is called `Value`: `Integer().compile()('x')` returns
`['Value must be a number']`.

## Types of your own

Classes that extend `ValidateType` (or a built-in type) with their own `validate()` or `isValid()` keep working when
compiled: the generated code calls them for their part of the schema. `validate()` returns `undefined` when the value
is valid and an error message otherwise.

```js
const { Schema, ValidateType } = require('schiva');

class Even extends ValidateType {
  validate(value, fieldName = 'Value') {
    const presence = super.validate(value, fieldName); // isMandatory and isNullable
    if (presence !== undefined || value === undefined || value === null) return presence;
    return value % 2 === 0 ? undefined : `${fieldName} must be even`;
  }
}

new Schema({ n: new Even() }).compile()({ n: 3 }); // ['n must be even']
```

## Security considerations

- **Schemas are code.** Compiling turns a schema into JavaScript, so treat schemas like the code of your program:
  compile schemas you wrote or trust, not schemas sent by users. A large or deeply nested schema is slow to compile
  and to validate.
- **Regular expressions.** `pattern`, `patternProperties` and `String({ pattern })` run the regular expression you
  give them on the data. A badly written one can take exponential time on some inputs
  ([ReDoS](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS)). Keep them simple,
  and limit the length of strings (`maxLength`, `String({ max })`) before matching long input.
- **Every error or the first one.** Collecting every error keeps checking after the first failure, so an invalid
  value costs more. For untrusted input where one message is enough, use `{ allErrors: false }` or `{ errors: false }`.
- **Large inputs.** `uniqueItems`/`unique` compares items with each other, so limit the size of arrays
  (`maxItems`, `ArrayOf({ max })`) that come from outside.
- **Content Security Policy.** The generated code is created with `new Function`, which needs `'unsafe-eval'` in the
  `script-src` of a Content Security Policy. Where that is not allowed, use `validate()` and `isValid()`, which do not
  generate code.
- **Circular data.** Values that contain themselves (`a.self = a`) are not supported.

Report security problems privately through [GitHub security advisories](https://github.com/jesus-seijas-sp/schiva/security/advisories/new),
not in public issues.

## Performance

Compared with ajv and the other validators of
[json-schema-benchmark](https://github.com/ebdrup/json-schema-benchmark), each measurement in its own process
(see [`bench/`](bench)):

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

## FAQ

**Should I use the DSL or JSON Schema?** Use JSON Schema when the schema is shared with other languages or tools
(OpenAPI, forms, other services). Use the DSL when the schema lives in your JavaScript code: it is shorter, and
`RegExp` patterns and types of your own fit in directly. Both compile to the same code, so the speed is the same.

**Why are errors strings and not objects?** Most errors end up in a log or an HTTP response. Strings with the path in
front are ready for that, and building them is cheap. If you only need to know whether a value is valid, use
`{ errors: false }`.

**Does it support draft 2019-09 or 2020-12?** Not yet: schiva implements draft-07. Keywords from later drafts, such as
`unevaluatedProperties` or `$defs`, throw when compiling.

**Does it check `format`?** No, see [JSON Schema](#json-schema).

**Does it include TypeScript types?** Not yet.

## Contributing

Issues and pull requests are welcome at [github.com/jesus-seijas-sp/schiva](https://github.com/jesus-seijas-sp/schiva).

```sh
pnpm install
pnpm test        # ESLint and Jest with coverage
```

## License

[MIT](LICENSE)
