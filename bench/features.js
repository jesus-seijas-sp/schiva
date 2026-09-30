/* eslint-disable no-console */
// Features benchmark: schiva and ajv on the features beyond validating JSON Schema, each with the same options
// (custom keywords, ajv-keywords, defaults and removal, type coercion, format limits, draft-04, error objects,
// standalone code), in isolated mode like isolated.js: one process per measurement, median of BENCH_RUNS.
// For the options that change the data, each call validates a new object, made the same way for both.
//
//   node features.js
//
// The child processes are started by this script: node features.js --child <case> <validator>
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const Ajv2020 = require('ajv/dist/2020').default;
const AjvDraft04 = require('ajv-draft-04');
const addFormats = require('ajv-formats');
const addKeywords = require('ajv-keywords');
const standaloneCode = require('ajv/dist/standalone').default;
const { compileJsonSchema, standaloneJsonSchema, ajvKeywords } = require('../src');
const { RUNS, measure, runChildren } = require('./lib/measure');
const { cases: payloads } = require('./lib/cases');

const even = { keyword: 'even', type: 'integer', validate: (value, data) => !value || data % 2 === 0 };
const shapes = payloads.find((c) => c.name.startsWith('shapes'));
const order = payloads.find((c) => c.name === 'order (20 lines) · valid');
const orderInvalid = payloads.find((c) => c.name === 'order (20 lines) · invalid');

// Loads a CommonJS module from its source (for standalone code).
function load(code) {
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func -- the module written by the library
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports.default || module.exports;
}

// Each case: a schema, how schiva and ajv compile it (schivaOptions; ajvOf(options) gives a compiled ajv function),
// and `make`, which gives the data of each call, with its expected verdict.
const cases = [
  {
    name: 'custom keyword (validate)',
    schema: { type: 'object', properties: { seats: { type: 'integer', even: true }, name: { type: 'string' } } },
    schivaOptions: { keywords: [even] },
    ajvOf: (options) => {
      const ajv = new Ajv({ strict: false, ...options });
      ajv.addKeyword({ keyword: 'even', type: 'number', validate: even.validate });
      return ajv;
    },
    data: { seats: 4, name: 'a' },
    expect: true,
  },
  {
    name: 'ajv-keywords (range, regexp, prohibited, uniqueItemProperties)',
    schema: {
      type: 'object',
      properties: {
        page: { type: 'integer', range: [1, 100] },
        q: { type: 'string', regexp: '/^[a-z]+$/i' },
        items: { type: 'array', uniqueItemProperties: ['id'] },
      },
      prohibited: ['password'],
    },
    schivaOptions: { keywords: ajvKeywords() },
    ajvOf: (options) => addKeywords(new Ajv({ strict: false, ...options })),
    data: { page: 3, q: 'Search', items: [{ id: 1 }, { id: 2 }] },
    expect: true,
  },
  {
    name: 'useDefaults and removeAdditional (defaults filled, 2 keys removed)',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string', default: 'anonymous' },
        tags: { type: 'array', items: { type: 'string' }, default: [] },
        active: { type: 'boolean', default: true },
      },
      required: ['id'],
      additionalProperties: false,
    },
    schivaOptions: { useDefaults: true, removeAdditional: true },
    ajvOf: (options) => new Ajv({ strict: false, useDefaults: true, removeAdditional: true, ...options }),
    make: () => ({ id: 1, extra: 1, other: 2 }),
    expect: true,
  },
  {
    name: 'coerceTypes (query string values)',
    schema: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        size: { type: 'integer', maximum: 100 },
        active: { type: 'boolean' },
        ids: { type: 'array', items: { type: 'integer' } },
      },
      required: ['page'],
    },
    schivaOptions: { coerceTypes: 'array' },
    ajvOf: (options) => new Ajv({ strict: false, coerceTypes: 'array', ...options }),
    make: () => ({ page: '2', size: '20', active: 'true', ids: '7' }),
    expect: true,
  },
  {
    name: 'formats with formatMinimum and formatMaximum',
    schema: {
      type: 'object',
      properties: {
        from: { type: 'string', format: 'date', formatMinimum: '2020-01-01', formatMaximum: '2030-12-31' },
        at: { type: 'string', format: 'date-time', formatExclusiveMaximum: '2030-01-01T00:00:00Z' },
        email: { type: 'string', format: 'email' },
      },
    },
    schivaOptions: { formats: true },
    ajvOf: (options) => addFormats(new Ajv({ strict: false, ...options })),
    data: { from: '2024-05-01', at: '2025-01-01T10:00:00Z', email: 'jane@example.com' },
    expect: true,
  },
  {
    name: 'tagged oneOf without discriminator (8 kinds)',
    schema: (() => {
      const schema = { ...shapes.schema };
      delete schema.discriminator;
      return schema;
    })(),
    schivaOptions: {},
    ajvOf: (options) => new Ajv({ strict: false, ...options }),
    data: shapes.data,
    expect: true,
  },
  {
    name: 'draft-04 (boolean exclusiveMaximum, id)',
    schema: {
      $schema: 'http://json-schema.org/draft-04/schema#',
      id: 'http://example.com/order.json',
      type: 'object',
      definitions: { price: { type: 'number', minimum: 0, maximum: 1000, exclusiveMaximum: true } },
      properties: {
        total: { $ref: '#/definitions/price' },
        lines: { type: 'array', items: { $ref: '#/definitions/price' } },
      },
      required: ['total'],
    },
    schivaOptions: {},
    ajvOf: (options) => new AjvDraft04({ strict: false, ...options }),
    data: { total: 99.5, lines: [10, 20, 69.5] },
    expect: true,
  },
  {
    name: 'error objects (order with 20 lines, invalid)',
    schema: orderInvalid.schema,
    schivaOptions: { errors: 'objects' },
    ajvOf: (options) => new Ajv({ strict: false, ...options }),
    data: orderInvalid.data,
    expect: false,
  },
  {
    name: 'standalone code (order with 20 lines, valid)',
    schema: order.schema,
    schivaOptions: {},
    standalone: true,
    ajvOf: (options) => new Ajv({ strict: false, code: { source: true }, ...options }),
    data: order.data,
    expect: true,
  },
  {
    name: 'unevaluatedProperties (payment 2020-12)',
    schema: payloads.find((c) => c.name.startsWith('payment')).schema,
    schivaOptions: {},
    ajvOf: (options) => new Ajv2020({ strict: false, ...options }),
    data: payloads.find((c) => c.name.startsWith('payment')).data,
    expect: true,
  },
];

// The validators: (c) => (data) => true or false.
const validators = [
  ['schiva (all errors)', {}],
  ['schiva (first error)', { allErrors: false }],
  ['ajv (all errors)', { allErrors: true }],
  ['ajv (first error)', {}],
].map(([name, options]) => ({
  name,
  compile: (c) => {
    if (name.startsWith('schiva')) {
      const schivaOptions = { ...c.schivaOptions, ...options };
      const fn = c.standalone
        ? load(standaloneJsonSchema(c.schema, schivaOptions))
        : compileJsonSchema(c.schema, schivaOptions);
      return (data) => fn(data).length === 0;
    }
    const ajv = c.ajvOf(options);
    const fn = ajv.compile(c.schema);
    return c.standalone ? load(standaloneCode(ajv, fn)) : fn;
  },
}));

// The data of a call: a new object for the cases that change it.
const dataOf = (c) => (c.make ? c.make : () => c.data);

if (process.argv[2] === '--child') {
  const c = cases[Number(process.argv[3])];
  const validate = validators[Number(process.argv[4])].compile(c);
  const make = dataOf(c);
  console.log(measure(() => validate(make())));
} else {
  console.log(`Features, isolated mode (one process per measurement, median of ${RUNS}).`);
  const results = {};
  cases.forEach((c, ci) => {
    const rows = [];
    validators.forEach((validator, vi) => {
      const valid = validator.compile(c)(dataOf(c)());
      if (valid !== c.expect) {
        throw new Error(`${validator.name} gives ${valid} for "${c.name}"`);
      }
      const { opsPerSec, spread } = runChildren(__filename, [String(ci), String(vi)]);
      rows.push({ name: validator.name, ops: opsPerSec, spread });
    });
    results[c.name] = { rows };
    console.log(`\n## ${c.name}`);
    console.table(
      rows.map((r) => ({ validator: r.name, 'ops/sec': Math.round(r.ops), 'spread %': r.spread.toFixed(1) }))
    );
  });
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', 'features.json'), JSON.stringify(results, null, 2));
}
