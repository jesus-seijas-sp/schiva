/* eslint-disable no-console */
// Conformance of schiva with the JSON-Schema-Test-Suite of one draft, file by file, next to ajv for reference.
// Usage: node conformance.js [draft4|draft6|draft7|draft2019-09|draft2020-12] [--failures] [--standalone] [--formats]
// With --standalone, schiva runs standalone code (standaloneJsonSchema()) loaded where code generation is disabled.
// With --formats, the optional tests of "format", with the formats checked (schiva: formats: true; ajv: ajv-formats).
const vm = require('vm');
const { compileJsonSchema, standaloneJsonSchema } = require('../src');
const Ajv = require('ajv');
const Ajv2019 = require('ajv/dist/2019').default;
const Ajv2020 = require('ajv/dist/2020').default;
const AjvDraft04 = require('ajv-draft-04');
const draft06 = require('ajv/dist/refs/json-schema-draft-06.json');
const addFormats = require('ajv-formats');
const { forDraft } = require('./validators');
const { DRAFTS, compileGroup, evaluate, loadGroups, loadRemotes } = require('./lib/suite');

const draft = process.argv[2] || 'draft2020-12';
const showFailures = process.argv.includes('--failures');
const standalone = process.argv.includes('--standalone');
const formats = process.argv.includes('--formats');
if (!DRAFTS[draft]) {
  throw new Error(`Unknown draft "${draft}": use one of ${Object.keys(DRAFTS).join(', ')}`);
}

const clone = (x) => JSON.parse(JSON.stringify(x));

// The schemas of the draft-04 and draft-06 tests have no "$schema": the draft is given as an option.
const schivaDraft = { draft4: 'draft-04', draft6: 'draft-06' }[draft];

// An ajv instance for the draft (draft-06 through its meta-schema, draft-04 with ajv-draft-04).
function newAjv(options = {}) {
  const AjvClass = { draft4: AjvDraft04, draft6: Ajv, draft7: Ajv, 'draft2019-09': Ajv2019, 'draft2020-12': Ajv2020 }[
    draft
  ];
  const instance = new AjvClass({ strict: false, ...options });
  if (draft === 'draft6') {
    instance.addMetaSchema(draft06);
  }
  return instance;
}

// A context where code generation from strings throws, for standalone code; the data is made in it too, so objects
// compare as they do when the data and the validator share one.
const sandbox = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
const parseInSandbox = vm.runInContext('JSON.parse', sandbox);

function loadStandalone(code) {
  const module = { exports: {} };
  vm.runInContext(
    `(function (module, exports) {
${code}
})`,
    sandbox
  )(module, module.exports);
  return (data) => module.exports(data === undefined ? undefined : parseInSandbox(JSON.stringify(data)));
}

// ajv for reference: with ajv-formats for --formats, and with the remotes for draft-04 and draft-06 (the other
// drafts use the one of validators.js).
function ajvValidator() {
  if (formats) {
    return {
      name: 'ajv',
      compile: (schema) => {
        const instance = newAjv();
        addFormats(instance);
        return instance.compile(clone(schema));
      },
    };
  }
  if (schivaDraft) {
    return {
      name: 'ajv',
      compile: (schema, remotes) => {
        const instance = newAjv();
        Object.entries(remotes)
          .filter(([uri]) => !uri.startsWith('http://json-schema.org/') && !uri.startsWith('https://json-schema.org/'))
          .forEach(([uri, remote]) => instance.addSchema(clone(remote), uri));
        return instance.compile(clone(schema));
      },
    };
  }
  return { ...forDraft(draft).find((validator) => validator.name === 'ajv (first error)'), name: 'ajv' };
}

const validators = [
  {
    name: 'schiva',
    compile: (schema, remotes) => {
      // The format tests follow the standard, where an unknown format is ignored: strict mode throws on it (as ajv's
      // does, which also runs with strict: false here).
      const options = { schemas: clone(remotes), formats, draft: schivaDraft, ...(formats && { strict: false }) };
      const fn = standalone
        ? loadStandalone(standaloneJsonSchema(clone(schema), options))
        : compileJsonSchema(clone(schema), options);
      return (data) => fn(data).length === 0;
    },
  },
  ajvValidator(),
];

const remotes = loadRemotes(draft);
const groups = loadGroups(draft, formats ? 'optional/format' : '');
const results = validators.map((validator) => ({ validator, ...evaluate(validator, groups, remotes) }));
const total = groups.reduce((n, g) => n + g.tests.length, 0);

console.log(`${draft}: ${groups.length} groups, ${total} tests\n`);
results.forEach((r) => {
  console.log(
    `${r.validator.name.padEnd(8)} ${r.testsOk} passed, ${r.testsFail - r.unsupported} wrong, ${r.unsupported} not compiled`
  );
});
console.log('\nFiles schiva does not fully pass (schiva / ajv / tests):');
const [schiva, ajv] = results;
Object.keys(schiva.perFile)
  .filter((file) => schiva.perFile[file].ok < schiva.perFile[file].total)
  .forEach((file) => {
    const { ok, total: count } = schiva.perFile[file];
    console.log(
      `  ${file.padEnd(34)} ${String(ok).padStart(4)} / ${String(ajv.perFile[file].ok).padStart(4)} / ${count}`
    );
  });

// With --failures, the reason of each failing group: the compile error, or the tests with a wrong result.
if (showFailures) {
  console.log('\nFailures:');
  groups.forEach((g) => {
    let fn;
    try {
      fn = compileGroup(validators[0], g, remotes);
    } catch (e) {
      console.log(`  ${g.file} > ${g.description}\n      compile: ${e.message}`);
      return;
    }
    const wrong = g.tests.filter((t) => {
      try {
        return fn(t.data) !== t.valid;
      } catch (e) {
        return true;
      }
    });
    if (wrong.length > 0) {
      console.log(`  ${g.file} > ${g.description}`);
      wrong.forEach((t) => console.log(`      wrong: ${t.description}`));
    }
  });
}
