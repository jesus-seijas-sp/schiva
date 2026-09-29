// JSON-Schema-Test-Suite (draft-07, 2019-09 and 2020-12): the test groups, the documents they reference, and each
// validator's results.
const fs = require('fs');
const path = require('path');

const SUITE = path.dirname(require.resolve('json-schema-test-suite/package.json'));

// Drafts by the name of their folder in the suite, with the meta-schema files that ajv ships for them.
const DRAFTS = {
  draft7: ['ajv/dist/refs/json-schema-draft-07.json'],
  'draft2019-09': 'ajv/dist/refs/json-schema-2019-09',
  'draft2020-12': 'ajv/dist/refs/json-schema-2020-12',
};

const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

function checkDraft(draft) {
  if (!DRAFTS[draft]) {
    throw new Error(`Unknown draft "${draft}": use one of ${Object.keys(DRAFTS).join(', ')}`);
  }
}

// The meta-schemas of a draft.
function metaSchemas(draft) {
  const meta = DRAFTS[draft];
  const files = Array.isArray(meta)
    ? meta.map((file) => require.resolve(file))
    : walk(path.dirname(require.resolve(`${meta}/schema.json`))).filter((file) => file.endsWith('.json'));
  return files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
}

// Documents the tests reference, given to every validator: the suite's remotes, which its runner serves at
// http://localhost:1234/ (leaving out the folders for other drafts), and the meta-schemas of the draft by their "$id".
function loadRemotes(draft = 'draft7') {
  checkDraft(draft);
  const remotesDir = path.join(SUITE, 'remotes');
  const others = ['draft3', 'draft4', 'draft6', 'draft-next', 'v1', ...Object.keys(DRAFTS)].filter((d) => d !== draft);
  const skip = new RegExp(`^(${others.join('|')})/`);
  const remotes = {};
  walk(remotesDir)
    .map((file) => path.relative(remotesDir, file).split(path.sep).join('/'))
    .filter((file) => file.endsWith('.json') && !skip.test(file))
    .forEach((file) => {
      remotes[`http://localhost:1234/${file}`] = JSON.parse(fs.readFileSync(path.join(remotesDir, file), 'utf8'));
    });
  metaSchemas(draft).forEach((schema) => {
    remotes[schema.$id.replace(/#$/, '')] = schema;
  });
  return remotes;
}

// Every test group of a draft's suite, in a stable order: { file, description, schema, tests }.
function loadGroups(draft = 'draft7') {
  checkDraft(draft);
  const dir = path.join(SUITE, 'tests', draft);
  const groups = [];
  fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .forEach((file) => {
      JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).forEach((g) => groups.push({ file, ...g }));
    });
  return groups;
}

// Compiles a group's schema with the validator (some libraries print warnings while compiling).
/* eslint-disable no-console -- silences them */
function compileGroup(validator, group, remotes) {
  const { warn } = console;
  console.warn = () => {};
  try {
    return validator.compile(group.schema, remotes);
  } finally {
    console.warn = warn;
  }
}
/* eslint-enable no-console */

// Conformance of a validator: the tests it gets right, gets wrong or cannot compile, and the groups it fully passes
// (with their compiled functions).
function evaluate(validator, groups, remotes) {
  const passed = [];
  const perFile = {};
  let testsOk = 0;
  let testsFail = 0;
  let unsupported = 0;
  groups.forEach((g, gi) => {
    perFile[g.file] = perFile[g.file] || { ok: 0, total: 0 };
    perFile[g.file].total += g.tests.length;
    let fn;
    try {
      fn = compileGroup(validator, g, remotes);
    } catch (e) {
      unsupported += g.tests.length;
      testsFail += g.tests.length;
      return;
    }
    let allOk = true;
    g.tests.forEach((t) => {
      let res;
      try {
        res = !!fn(t.data);
      } catch (e) {
        res = 'throw';
      }
      if (res === t.valid) {
        testsOk += 1;
        perFile[g.file].ok += 1;
      } else {
        testsFail += 1;
        allOk = false;
      }
    });
    if (allOk) passed.push({ gi, fn });
  });
  return { passed, perFile, testsOk, testsFail, unsupported };
}

// Speed set: indexes of the groups every validator passes, so all of them do the same work.
function commonGroups(results) {
  return results[0].passed.map((p) => p.gi).filter((gi) => results.every((r) => r.passed.some((p) => p.gi === gi)));
}

// One run over every test of the given groups, with a function per group.
function suiteRun(fns, groups, indexes) {
  const work = indexes.map((gi, i) => ({ fn: fns[i], data: groups[gi].tests.map((t) => t.data) }));
  return () => {
    for (let i = 0; i < work.length; i += 1) {
      const { fn, data } = work[i];
      for (let j = 0; j < data.length; j += 1) fn(data[j]);
    }
  };
}

// Results file content, shared by both modes; `speed` gives each validator's { opsPerSec, spread }.
function summary(groups, results, common, speed, mode) {
  return {
    mode,
    totalGroups: groups.length,
    totalTests: groups.reduce((n, g) => n + g.tests.length, 0),
    commonGroups: common.length,
    commonTests: common.reduce((n, gi) => n + groups[gi].tests.length, 0),
    commonFiles: [...new Set(common.map((gi) => groups[gi].file))],
    validators: results.map((r) => ({
      name: r.validator.name,
      testsOk: r.testsOk,
      testsFail: r.testsFail,
      unsupported: r.unsupported,
      groupsPassed: r.passed.length,
      ...speed[r.validator.name],
    })),
    schivaPerFile: results[0].perFile,
  };
}

module.exports = {
  DRAFTS,
  loadRemotes,
  loadGroups,
  compileGroup,
  evaluate,
  commonGroups,
  suiteRun,
  summary,
};
