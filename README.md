# schiva

[![npm](https://img.shields.io/npm/v/schiva.svg)](https://www.npmjs.com/package/schiva)
[![CI](https://github.com/jesus-seijas-sp/schiva/actions/workflows/ci.yml/badge.svg)](https://github.com/jesus-seijas-sp/schiva/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

Fast schema validation for JavaScript. Describe data with a small schema DSL or with JSON Schema (draft-04 to
2020-12), and schiva compiles it into a JavaScript function generated for that schema, so validating is several times
faster than walking the schema for every value.

**Documentation: [schiva.js.org](https://schiva.js.org)** &middot; [Guide](https://schiva.js.org/guide.html) &middot;
[Playground](https://schiva.js.org/playground.html) &middot;
[Schema from JSON](https://schiva.js.org/infer.html) &middot;
[API reference](https://schiva.js.org/api.html) &middot; [Benchmarks](https://schiva.js.org/benchmarks.html) &middot;
[Migrating from ajv](https://schiva.js.org/migrating-from-ajv.html)

## Contents

- [Features](#features)
- [Install](#install)
- [Getting started](#getting-started)
- [Modes](#modes)
- [Compile once](#compile-once)
- [Standalone code](#standalone-code)
- [Schema DSL](#schema-dsl)
- [JSON Schema](#json-schema)
- [Errors](#errors)
- [TypeScript](#typescript)
- [Schemas from samples](#schemas-from-samples)
- [Types of your own](#types-of-your-own)
- [Security considerations](#security-considerations)
- [Performance](#performance)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Two schema languages, one engine**: a small DSL (`String()`, `Integer({ min: 18 })`...) and JSON Schema (draft-04,
  draft-06, draft-07, 2019-09 and 2020-12) compile to the same types and the same generated code.
- **Complete**: passes the whole [JSON-Schema-Test-Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite)
  of draft-04 (618 of 618 tests), draft-06 (841 of 841), draft-07 (929 of 929), 2019-09 (1261 of 1261) and 2020-12
  (1301 of 1301): `$ref` with JSON pointers, `$id` base URIs, anchors, recursive schemas and references to other
  documents (given, or loaded with `compileJsonSchemaAsync()`), `unevaluatedProperties` and `unevaluatedItems`, dynamic
  references (`$dynamicRef`, `$recursiveRef`) and vocabularies. See [Drafts](#drafts).
- **Readable errors** with the path of each field: `lines[12].price must be a number`.
- **Three modes**: every error, the first error only, or just `true`/`false`; errors as messages, or as objects with
  their path, keyword and params.
- **Fast**: faster than ajv in every [benchmark](#performance) we run, and about 40 times faster at compiling.
- **Strict**: unknown or unsupported keywords throw when compiling instead of being silently ignored, unless declared
  (`keywords: ['x-internal']`) or with `strict: false`.
- **Defaults, removal and conversion**: `useDefaults`, `removeAdditional` and `coerceTypes`, as in ajv, when you want
  the data changed.
- **OpenAPI**: `nullable`, `discriminator` with `mapping` (several times faster than `oneOf`), and `x-` keywords
  declared as annotations.
- **No dependencies**, CommonJS and ESM, Node.js 18 and later, and browsers through any bundler.
- **TypeScript**: type declarations included, and `Infer<typeof schema>` gives the type of the values a DSL schema
  accepts; compiled boolean validators are type guards.
- **Formats**: optional checks of `format` (dates, email, host names with IDNA, URIs...), passing every format test
  of the JSON-Schema-Test-Suite. See [Formats](#formats).
- **Standalone code**: validators written out as modules when building, for strict Content Security Policies.
- **Schemas from samples**: `inferJsonSchema()` and `inferSchemaCode()` write the schema of your JSON samples, as JSON
  Schema or DSL code; also [in the browser](https://schiva.js.org/infer.html).
- **Extensible**: keywords of your own in JSON Schema (`validate`, `compile` or `macro`, and the ones of ajv-keywords
  with `ajvKeywords()`), and classes of your own with a `validate()` method inside compiled schemas.

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
| `{ errors: 'objects' }` | every error as an object, `[]` when valid (with `allErrors: false`, the first) | errors are handled by code: forms, translations; see [Error objects](#error-objects) |

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

`compile()` creates the function with `new Function`, which does not run where code generation is forbidden (for
example with a strict Content Security Policy). There, generate [standalone code](#standalone-code) when building.

## Standalone code

`standaloneCode(type, options)` returns the code of a validator as the source of a JavaScript module, to save to a
file when building and load like any other. Loading it generates no code, so it runs under a strict Content Security
Policy (without `'unsafe-eval'`) and in runtimes that forbid code generation, and it needs nothing else: not even
schiva, as the few helpers it calls are written into it.

```js
// build-validators.js, run when building
const fs = require('fs');
const { standaloneCode, standaloneModule, standaloneJsonSchema } = require('schiva');

fs.writeFileSync('validate-person.js', standaloneCode(person)); // module.exports = the validation function
fs.writeFileSync('validators.mjs', standaloneModule({ isPerson: person, isOrder: order }, { errors: false, format: 'esm' }));
fs.writeFileSync('validate-address.js', standaloneJsonSchema(addressSchema, { schemas: [countrySchema] }));
```

```js
// In the application
const validatePerson = require('./validate-person.js');
import { isPerson } from './validators.mjs';
```

The options are those of `compile()` (`allErrors`, `errors`) and `format`: `'commonjs'` (the default) or `'esm'`.
`standaloneCode()` exports one function (`module.exports`, or the default export), and `standaloneModule()` one for
each name. `standaloneJsonSchema()` takes the options of `compileJsonSchema()` too. The functions return the same
results as the ones `compile()` gives: schiva checks it on every test of the JSON-Schema-Test-Suite
(`pnpm run conformance draft2020-12 --standalone`). [Types of your own](#types-of-your-own) cannot be written out,
as their `validate()` runs when validating, and throw.

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
| `String` | `min`, `max` (length), `pattern` (RegExp), `format` (a [built-in format](#formats)), `allowEmpty`, `countCodePoints` |
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

`fromJsonSchema(json, options)` converts a JSON Schema into the same types, and `compileJsonSchema(json, options)`
compiles it. Every validation keyword of draft-07 is supported, along with `definitions` (or `$defs`) and `$ref` (JSON
pointers, `$id` base URIs and anchors, recursive schemas). String lengths count Unicode code points, as the
specification says. `multipleOf` divides in floating point, so 0.3 is not a multiple of 0.1; with the option
`multipleOfPrecision: 8`, a division within 1e-8 of an integer passes, as with ajv's option.

A keyword schiva does not know throws when compiling, with the place where it was found:

```js
compileJsonSchema({ type: 'string', maxLenght: 10 });
// Error: Unsupported JSON Schema keyword "maxLenght" at #
```

Annotations (`title`, `description`, `default`, `examples`, `$comment`, `readOnly`, `writeOnly`, `deprecated`) are
accepted and ignored. The content keywords (`contentMediaType`, `contentEncoding`, `contentSchema`) are annotations too.

Keywords of your own, such as the `x-` extensions of OpenAPI, can be declared as annotations with the option
`keywords`, and the typos are still caught. `strict: false` ignores every unknown keyword instead, and also the ones of
other drafts and the ones a `type` excludes, as the JSON Schema standard reads a schema:

```js
compileJsonSchema(schema, { keywords: ['x-internal', 'example'] });
compileJsonSchema(schema, { strict: false }); // like ajv's strict: false
```

### Keywords of your own

The option `keywords` also takes definitions of keywords that check values, like ajv's `addKeyword()`. A definition has
its `keyword`, optionally the JSON `type` of the values it checks (every value by default), and one function:

- `validate(value, data, parentSchema)`: called for each value with the value of the keyword; `true` when valid.
- `compile(value, parentSchema)`: called once, when compiling; gives the function checking the data, or a regular
  expression that the data must match.
- `macro(value, parentSchema)`: gives a schema to check instead, so the keyword is other keywords written shorter. It
  compiles to the same code as those keywords.

`message` gives the text of its error after the name of the value, or a function `(value, data) => text` does
(`must pass the "<keyword>" keyword` by default). Its error objects have its name as `keyword`.

```js
const even = { keyword: 'even', type: 'integer', validate: (value, data) => !value || data % 2 === 0, message: 'must be even' };
const between = { keyword: 'between', type: 'number', macro: ([min, max]) => ({ minimum: min, maximum: max }) };

const validate = compileJsonSchema(
  { properties: { seats: { type: 'integer', even: true, between: [2, 8] } } },
  { keywords: [even, between] }
);

validate({ seats: 3 }); // ['seats must be even']
validate({ seats: 10 }); // ['seats must be at most 8']
```

`ajvKeywords()` gives the keywords of [ajv-keywords](https://github.com/ajv-validator/ajv-keywords), with the same
results: `typeof`, `instanceof`, `range`, `exclusiveRange`, `regexp`, `uniqueItemProperties`, `allRequired`,
`anyRequired`, `oneRequired`, `patternRequired`, `prohibited`, `deepProperties` and `deepRequired`. Name the ones you
use, or leave the list out for all of them:

```js
compileJsonSchema(schema, { keywords: ajvKeywords(['range', 'regexp']) });
compileJsonSchema(schema, { keywords: ['x-internal', ...ajvKeywords()] });
```

`transform` changes the data and `dynamicDefaults` computes defaults when validating (schiva only assigns fixed
defaults, see [useDefaults](#changing-the-data)), and `select` needs `$data` references, so they are left out. Macros and regular expressions can be written into [standalone code](#standalone-code), functions
cannot: among ajv-keywords, `range`, `exclusiveRange`, `regexp` (without the flags g and y), `allRequired`,
`anyRequired`, `oneRequired`, `prohibited` and `deepProperties` can.

### Changing the data

schiva only checks values unless you ask for one of these options, which change the value being validated as ajv's do:

- `useDefaults: true` assigns the `default` of each missing property (in `properties`) and tuple element before
  checking it, so `required` is satisfied and the default is checked too. `useDefaults: 'empty'` also replaces `null`
  and `''`. Each validation assigns a new copy of the default.
- `removeAdditional: true` removes the additional properties where `additionalProperties` is `false`, instead of
  reporting them. `'all'` removes every additional property of a schema with `properties` or `additionalProperties`,
  and `'failing'` the ones that fail `additionalProperties` (and where it is `false`). The keys a `patternProperties`
  pattern matches are not additional.
- `coerceTypes: true` converts a value that is not of the types its schema's `type` asks for, trying them in order,
  and writes the converted value back into its object or array: numeric strings, booleans and `null` to numbers
  (integers only when whole), numbers and booleans to strings (`null` to `''`), `'true'`, `'false'`, `1`, `0` and
  `null` to booleans, and `''`, `0` and `false` to `null`. `coerceTypes: 'array'` also wraps a value into an array,
  and takes the element of an array of one where a single value is expected. The value validated itself, in no object
  or array, is converted for the validation only.

```js
const validate = compileJsonSchema(
  {
    type: 'object',
    properties: { name: { type: 'string' }, role: { type: 'string', default: 'user' } },
    required: ['name'],
    additionalProperties: false,
  },
  { useDefaults: true, removeAdditional: true }
);

const user = { name: 'Ann', password: 'secret' };
validate(user); // []
user; // { name: 'Ann', role: 'user' }
```

A value is converted by its schema's own `type` (or else by the first part of its `allOf`, or the schema its `$ref`
points to), once; ajv also converts it inside `anyOf` and `oneOf` schemas, even ones that then do not apply. List the
types in one `type` instead: `type: ['number', 'boolean']`. ajv only takes the element of an array of one for schemas
with one type.

As in ajv, defaults inside `anyOf`, `oneOf`, `not` and `if` (directly or through `$ref`) are not assigned, as those
schemas may not apply: they throw, or are ignored with `strict: false`. `required`, `minProperties` and `maxProperties`
see the additional properties before they are removed. Removing properties inside `anyOf`, `oneOf`, `not` or `if` can
remove them while trying a schema that then does not apply, and the result depends on the order the keywords run, which
is not always ajv's: remove them in the schemas that always apply. An invalid value may be changed only in part, more
so when stopping at the first error.

### Discriminator

The `discriminator` of OpenAPI picks the `oneOf` schema that applies by the value of a property, which must be
required. An object is only checked against the schema its value picks, with the errors of that schema, which is several
times faster than trying every schema; a value that picks none gets an error about the property. Other values are
checked as by `oneOf`. The value of each schema comes from, in this order:

- `mapping`: values to references or to schema names, as in OpenAPI.
- A `const` or an `enum` that the schema (or the schema it references) gives the property, as ajv reads it.
- Else the name of the schema it references: `Dog` for `#/components/schemas/Dog`, OpenAPI's implicit mapping.

```js
const validate = compileJsonSchema({
  $defs: {
    Cat: { type: 'object', properties: { lives: { type: 'integer' } }, required: ['petType', 'lives'] },
    Dog: { type: 'object', properties: { bark: { type: 'boolean' } }, required: ['petType'] },
  },
  oneOf: [{ $ref: '#/$defs/Cat' }, { $ref: '#/$defs/Dog' }],
  discriminator: { propertyName: 'petType', mapping: { cat: '#/$defs/Cat', dog: 'Dog' } },
});

validate({ petType: 'cat' }); // ['lives is mandatory']
validate({ petType: 'cow' }); // ['petType must be one of: cat, dog']
```

With values from `const` and `enum` alone, no other schema accepts the value, so the result is the one of `oneOf`. With
`mapping` or names, the property picks the schema as OpenAPI means it, whatever the other schemas accept. ajv only
reads `const` and `enum`, and rejects `mapping`.

A `oneOf` without `discriminator` whose schemas give one property distinct string values with `const` or `enum` is
checked the same way: the result is the one of `oneOf`, the errors of an object whose value picks a schema are the ones
of that schema, and a value that picks none gets the errors of `oneOf`.

### Formats

`format` is an annotation by default, as the drafts allow: nothing is checked. The option `formats` turns the checks
on:

```js
const validate = compileJsonSchema(
  { type: 'object', properties: { email: { type: 'string', format: 'email' }, since: { format: 'date' } } },
  { formats: true }
);

validate({ email: 'x', since: '2026-02-30' }); // ['email must be a valid email', 'since must be a valid date']
```

- `formats: true` checks every built-in format: `date`, `time`, `date-time`, `duration`, `email`, `idn-email`,
  `hostname`, `idn-hostname`, `ipv4`, `ipv6`, `uri`, `uri-reference`, `iri`, `iri-reference`, `uuid`, `uri-template`,
  `json-pointer`, `relative-json-pointer` and `regex`.
- `formats: ['email', 'date']` checks only those.
- `formats: { phone: /^\+\d+$/, even: (text) => text.length % 2 === 0, email: true }` adds formats of your own, a regular
  expression or a function, and `true` picks a built-in one. `false` names a format that is known but not checked, such
  as OpenAPI's `int32`.
- `formats: { ...builtInFormats(), int32: false }` checks every built-in format and adds your own.

With the option, a format it does not name throws when compiling, as in ajv's strict mode, since it is most likely a
typo (`"emial"`): name it, with `false` to leave it unchecked, or use `strict: false` to ignore unknown formats. Without
the option, any format is an annotation. A format applies to strings only. The built-in formats follow their
RFCs: dates and times with leap years and leap seconds (RFC 3339), email addresses with quoted local parts and IP
literals, and internationalized host names with punycode, IDNA2008 and the Bidi rule. schiva passes every test of
the optional format tests of the JSON-Schema-Test-Suite (793 of draft-07, 874 of 2019-09 and of 2020-12;
`pnpm run conformance draft2020-12 --formats`); ajv with ajv-formats passes 655 and 733.

`formatMinimum`, `formatMaximum`, `formatExclusiveMinimum` and `formatExclusiveMaximum` limit the values of a format
that can be compared (`date`, `time` and `date-time`), as ajv-formats does, with the same results:

```js
const validate = compileJsonSchema(
  { type: 'string', format: 'date', formatMinimum: '2020-01-01', formatExclusiveMaximum: '2021-01-01' },
  { formats: true }
);

validate('2019-12-31'); // ['Value must be at least 2020-01-01']
```

Times and date-times compare by the moment they name, whatever their time zone. As in ajv the limits need `format`,
and are checked only when the format is. A format of your own can be compared too, given as
`{ validate, compare }` in `formats`, where `compare(a, b)` gives a negative number, 0 or a positive number. Where
ajv ignores a limit that is not a valid value of its format, schiva throws.

In the DSL, a `String` takes a built-in format too: `String({ format: 'email' })`.

### Drafts

The draft comes from `options.draft` (`'draft-04'`, `'draft-06'`, `'draft-07'`, `'2019-09'` or `'2020-12'`), or else
from the `$schema` of the schema. Without either, or with another `$schema`, the schema is read as draft-07. Each
schema resource inside it, or document it references, is read in the draft its own `$schema` names, so a 2020-12 schema
can reference draft-07 ones. A `$schema` can also name a meta-schema given in `options.schemas`: its draft applies, and
the keywords of the vocabularies its `$vocabulary` leaves out are ignored.

```js
const validate = compileJsonSchema({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  prefixItems: [{ type: 'string' }, { type: 'integer' }],
  items: false,
});

validate(['a', 1]); // []
validate(['a', 1, 2]); // ['Value[2] is not allowed']
```

The older drafts differ from draft-07 in a few keywords. Draft-06 has no `if`/`then`/`else`. Draft-04 has no `const`,
`contains` or `propertyNames` either, changes the base URI with `id` instead of `$id`, and makes `exclusiveMinimum` and
`exclusiveMaximum` booleans that make `minimum` and `maximum` exclusive. schiva passes their whole
JSON-Schema-Test-Suite too (618 of 618 tests for draft-04, 841 of 841 for draft-06).

Drafts 2019-09 and 2020-12 add, and schiva supports:

- `$defs` and `$anchor` (and `$dynamicAnchor` as a plain anchor for `$ref`).
- `dependentRequired` and `dependentSchemas`, which split `dependencies` in two.
- `minContains` and `maxContains`.
- `prefixItems` (2020-12), which takes over the tuple form of `items`: in 2020-12 `items` is a schema for the elements
  after `prefixItems`, and `additionalItems` is gone.
- Keywords next to `$ref` apply too, where draft-07 ignores them.
- `unevaluatedProperties` and `unevaluatedItems`: the keys or elements that no other keyword of the schema evaluated,
  directly or through `allOf`, `anyOf`, `oneOf`, `if`/`then`/`else`, `$ref` or `dependentSchemas`, must satisfy them.

```js
const validate = compileJsonSchema({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: { base: { properties: { id: { type: 'integer' } } } },
  $ref: '#/$defs/base',
  properties: { name: { type: 'string' } },
  unevaluatedProperties: false,
});

validate({ id: 1, name: 'a' }); // []
validate({ id: 1, name: 'a', extra: true }); // ['Unexpected key: extra']
```

When the keys those keywords evaluate are the same for every value, as with `$ref`, `allOf` and `properties`, the
check compiles to a loop over the other keys, as fast as `additionalProperties`. With `anyOf`, `oneOf`, `if` or
`dependentSchemas` it depends on the value, and the generated code works it out first.

Dynamic references, `$dynamicRef` (2020-12) and `$recursiveRef` (2019-09), let a schema extend another that refers
to itself: the reference points to the outermost schema being evaluated that has the same `$dynamicAnchor` (or
`$recursiveAnchor`). Here a generic tree accepts any key, and the strict tree that extends it rejects unknown keys at
every level:

```js
const tree = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.com/tree',
  $dynamicAnchor: 'node',
  type: 'object',
  properties: { data: true, children: { type: 'array', items: { $dynamicRef: '#node' } } },
};
const validate = compileJsonSchema(
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://example.com/strict-tree',
    $dynamicAnchor: 'node',
    $ref: 'tree',
    unevaluatedProperties: false,
  },
  { schemas: [tree] }
);

validate({ children: [{ daat: 1 }] }); // ['Unexpected key: children[0].daat']
```

The target of a dynamic reference depends on the schemas being evaluated, and schiva still works it out when
compiling: a schema reached in different ways is compiled once for each, so the generated code stays as fast as for
`$ref`. With these, schiva passes the whole JSON-Schema-Test-Suite of every draft it supports (`pnpm run conformance
draft2020-12` shows it file by file).

### Several documents

References to other documents resolve against the documents given in `options.schemas`, as `{ uri: schema }` or as an
array of schemas with `$id`. `compileJsonSchema()` loads nothing, and a reference that cannot be resolved throws when
compiling:

```js
const validateOrder = compileJsonSchema(orderSchema, {
  schemas: { 'https://example.com/schemas/address.json': addressSchema },
});
```

To load them instead, `compileJsonSchemaAsync(json, options)` asks `options.loadSchema(uri)`, an async function you
write, for each document the schema references and `schemas` does not have, and for the ones those reference in turn,
once each (like ajv's `compileAsync()`). `loadJsonSchemas(json, options)` gives the documents it loaded, with
`options.schemas`, to compile later or to write [standalone code](#standalone-code):

```js
const validateOrder = await compileJsonSchemaAsync(orderSchema, {
  loadSchema: async (uri) => (await fetch(uri)).json(),
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
`['Value must be a number']`. Keys are named the same way whether or not the schema combines keywords (`allOf`,
`$ref` with other keywords, `unevaluatedProperties`...): `name`, not `Value.name`.

With every error (the default mode), the errors of every part of a schema are reported, including every schema of an
`allOf`, and each message appears once even when two parts find the same problem.

### Error objects

With `errors: 'objects'`, the compiled function returns each error as an object, for code that handles them (showing
them next to form fields, translating them, or [moving from ajv](https://schiva.js.org/migrating-from-ajv.html)):

```js
order.compile({ errors: 'objects' })({ id: 1, lines: [{ price: -1 }] });
// [
//   { path: ['id'], pointer: '/id', keyword: 'type', params: { type: 'string' }, message: 'id must be a string' },
//   { path: ['lines', 0, 'price'], pointer: '/lines/0/price', keyword: 'minimum', params: { limit: 0 },
//     message: 'lines[0].price must be at least 0' },
// ]
```

- `path`: the keys and indexes of the value, `[]` for the value itself; `pointer` is the same path as a JSON Pointer.
- `keyword`: the check that failed, with the name of the JSON Schema keyword: `type`, `required` (missing), `nullable`
  (`null` not allowed), `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`,
  `maxLength`, `pattern`, `format`, `enum`, `const`, `minItems`, `maxItems`, `uniqueItems`, `contains`, `minContains`,
  `maxContains`, `minProperties`, `maxProperties`, `additionalProperties` and `unevaluatedProperties` (an unexpected
  key, whose path it is), `dependentRequired` (at the path of the missing property), `not`, `oneOf`, `false` (a value no
  schema allows) and `custom` (a [type of your own](#types-of-your-own)).
- `params`: its details, such as `{ limit: 0 }`, `{ allowedValues: [...] }`, `{ property: 'extra' }` or
  `{ format: 'email' }`; `{}` when there are none.
- `message`: the same message as with the default mode. An error of `propertyNames` also has `propertyName: true`.

It works with `compileJsonSchema()` and in [standalone code](#standalone-code) too; `validate()` still gives
messages.

## TypeScript

schiva includes its type declarations. `Infer` gives the TypeScript type of the values a DSL schema accepts, and a
function compiled with `{ errors: false }` is a type guard:

```ts
import { Schema, String, Integer, ArrayOf, Enum, Infer } from 'schiva';

const person = new Schema({
  id: String(),
  age: Integer({ min: 18 }),
  status: Enum({ options: ['active', 'blocked'] }),
  tags: ArrayOf({ type: String(), isMandatory: false }),
  address: { city: String(), zip: String({ isNullable: true }) },
});

type Person = Infer<typeof person>;
// { id: string; age: number; status: 'active' | 'blocked'; address: { city: string; zip: string | null };
//   tags?: string[] | undefined }

const isPerson = person.compile({ errors: false });
if (isPerson(body)) {
  body.address.city; // body is a Person here
}
```

A key whose type accepts `undefined` (`isMandatory: false`, `.optional()`) is an optional property, and `isNullable`
adds `null`. `ArrayOf` gives arrays and tuples, `AnyOf` and `OneOf` unions, and `AllOf` intersections. A recursive
schema needs the type of its `Ref`: `const child = Ref<TreeNode>()`.

The values a JSON Schema accepts are `unknown` to TypeScript; give their type to get a type guard:
`compileJsonSchema<User>(schema, { errors: false })`.

## Schemas from samples

`inferJsonSchema(samples, options)` writes the JSON Schema of a list of sample values, and
`inferSchemaCode(samples, options)` the same schema in the DSL, as the source of a module. Try it in the browser with
[Schema from JSON](https://schiva.js.org/infer.html).

```js
const { inferJsonSchema, inferSchemaCode } = require('schiva');

const samples = [
  { id: 1, name: 'Ann', email: 'ann@example.com', address: { city: 'Madrid' } },
  { id: 2, name: 'Bob', email: 'bob@example.com', address: null, phone: '+34 600 000 000' },
];

console.log(inferSchemaCode(samples));
// const { Integer, Schema, String } = require('schiva');
//
// const schema = new Schema({
//   id: Integer(),
//   name: String(),
//   email: String({ format: 'email' }),
//   address: new Schema({
//     city: String(),
//   }, { isNullable: true }),
//   phone: String({ isMandatory: false }),
// });
```

A key is required when every object at that place has it, `null` makes a value nullable, integers and numbers make a
number, the elements of arrays are merged, and strings get a format (`date-time`, `date`, `time`, `email`, `uuid`,
`ipv4`, `ipv6`, `uri`) when every one matches it. Options: `closed` (reject unknown keys), `formats` (`false` detects
none), `draft` (the `$schema` written, `'2020-12'` by default), and for `inferSchemaCode()` `name` and `module`
(`'commonjs'`, `'esm'` or `'none'`). The schema accepts every sample and is a starting point: add the limits the data
needs.

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
- **Content Security Policy.** `compile()` creates the function with `new Function`, which needs `'unsafe-eval'` in
  the `script-src` of a Content Security Policy. Where that is not allowed, generate [standalone code](#standalone-code)
  when building, which runs without it.
- **Circular data.** Values that contain themselves (`a.self = a`) are not supported.

Report security problems privately through [GitHub security advisories](https://github.com/jesus-seijas-sp/schiva/security/advisories/new),
not in public issues.

## Performance

Compared with ajv and the other validators of
[json-schema-benchmark](https://github.com/ebdrup/json-schema-benchmark), each measurement in its own process
(see [`bench/`](bench)). Higher is better; each library is compared in the same mode (first error or all errors).
Every library, every payload, the tests each one passes and the speed of the features are on the
[benchmarks page](https://schiva.js.org/benchmarks.html).

**JSON-Schema-Test-Suite**, in runs per second over the test groups every validator passes. For drafts 2019-09 and
2020-12 only the validators that implement them run (ajv with its `Ajv2019` and `Ajv2020` classes):

| | draft-07 | 2019-09 | 2020-12 |
|---|---|---|---|
| schiva, first error | **124k** | **22.1k** | **25.7k** |
| ajv, first error | 60k | 4k–15k ¹ | 5k–15k ¹ |
| @exodus/schemasafe, first error | 98k | 14.9k | 17.1k |
| schiva, all errors | **101k** | **17.1k** | **19.4k** |
| ajv, all errors | 51k | 3.6k–12k ¹ | 5k–12k ¹ |
| @exodus/schemasafe, all errors | 64k | 6.9k | 9.7k |
| schiva, true/false | **177k** | **30.9k** | **34.7k** |
| @exodus/schemasafe, true/false | 147k | 24.0k | 27.5k |
| Tests passed: schiva / ajv / schemasafe | **929** / 921 / 905 | **1261** / 1233 / 1228 | **1301** / 1239 / 1263 |

¹ ajv's speed on these two suites changes from one process to the next, between the two numbers given.

schiva passes every test of the three suites. Of the other validators, the one that passes the most tests of drafts
2019-09 and 2020-12 is json-schema-library (1260 and 1291), at about 1/400 of the speed of schiva.

**Payloads**, in validations per second (compiling: schemas per second):

| | schiva, first error | ajv, first error | schiva, all errors | ajv, all errors |
|---|---|---|---|---|
| moltar strict, valid | **33.1M** | 29.1M | **30.6M** | 27.9M |
| moltar strict, invalid | **78.9M** | 36.0M | **20.8M** | 17.5M |
| Order with 20 lines, valid | **2.16M** | 0.74M | **2.23M** | 0.71M |
| Order with 20 lines, invalid | **17.1M** | 12.2M | **1.86M** | 0.44M |
| Order 2020-12 (`$ref`, `allOf`, `unevaluatedProperties`), valid | **2.32M** | 0.66M | **2.29M** | 0.65M |
| Order 2020-12, invalid | **31.7M** | 15.0M | **1.53M** | 0.38M |
| Payment 2020-12 (`oneOf` and `unevaluatedProperties`), valid | **15.2M** | 8.8M | **15.3M** | 8.0M |
| Payment 2020-12, invalid | **14.5M** | 7.5M | **13.8M** | 6.2M |
| Shapes, `discriminator` with 8 kinds, valid | **117M** | 44.8M | **105M** | 44.7M |
| Shapes, invalid | **122M** | 37.1M | **44.3M** | 19.7M |
| Compiling the order schema | **8.4k** | 0.19k | **8.3k** | 0.23k |

```sh
pnpm run bench         # every validator in its own process (about 15 minutes)
pnpm run bench:quick   # every validator in one process (about a minute)
pnpm run conformance   # tests passed by schiva and ajv, file by file, for one draft
```

Benchmarks depend on the machine: run them with nothing else busy, as a validator measured while the computer is
loaded looks several times slower than it is.

## FAQ

**Should I use the DSL or JSON Schema?** Use JSON Schema when the schema is shared with other languages or tools
(OpenAPI, forms, other services). Use the DSL when the schema lives in your JavaScript code: it is shorter, and
`RegExp` patterns and types of your own fit in directly. Both compile to the same code, so the speed is the same.

**Why are errors strings by default?** Most errors end up in a log or an HTTP response. Strings with the path in front
are ready for that, and building them is cheap. For errors handled by code, use `{ errors: 'objects' }` (see
[Error objects](#error-objects)); to know only whether a value is valid, `{ errors: false }`.

**How do I move from ajv?** Your JSON Schemas stay as they are; the code around them changes a little. See
[Migrating from ajv](https://schiva.js.org/migrating-from-ajv.html).

**Does it support draft 2019-09 or 2020-12?** Yes, completely: schiva passes their whole JSON-Schema-Test-Suite,
dynamic references and vocabularies included. See [Drafts](#drafts).

**Does it check `format`?** When you ask it to, with the option `formats` (or `String({ format })` in the DSL): see
[Formats](#formats).

**Does it include TypeScript types?** Yes, and it infers the type of the values a DSL schema accepts: see
[TypeScript](#typescript).

## Contributing

Issues and pull requests are welcome at [github.com/jesus-seijas-sp/schiva](https://github.com/jesus-seijas-sp/schiva).

```sh
pnpm install
pnpm test        # ESLint and Jest with coverage
```

## License

[MIT](LICENSE)
