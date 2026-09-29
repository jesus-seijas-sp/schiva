/* eslint-disable no-console */
// Conformance of schiva with the JSON-Schema-Test-Suite of one draft, file by file, next to ajv for reference.
// Usage: node conformance.js [draft7|draft2019-09|draft2020-12] [--failures]
const { compileJsonSchema } = require('../src');
const { forDraft } = require('./validators');
const { DRAFTS, compileGroup, evaluate, loadGroups, loadRemotes } = require('./lib/suite');

const draft = process.argv[2] || 'draft2020-12';
const showFailures = process.argv.includes('--failures');
if (!DRAFTS[draft]) {
  throw new Error(`Unknown draft "${draft}": use one of ${Object.keys(DRAFTS).join(', ')}`);
}

const clone = (x) => JSON.parse(JSON.stringify(x));

const validators = [
  {
    name: 'schiva',
    compile: (schema, remotes) => {
      const fn = compileJsonSchema(clone(schema), { schemas: clone(remotes) });
      return (data) => fn(data).length === 0;
    },
  },
  { ...forDraft(draft).find((validator) => validator.name === 'ajv (first error)'), name: 'ajv' },
];

const remotes = loadRemotes(draft);
const groups = loadGroups(draft);
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
