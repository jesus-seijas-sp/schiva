// JSON-Schema-Test-Suite (draft-07): the test groups, the documents they reference, and each validator's results.
const fs = require('fs');
const path = require('path');

const SUITE = path.dirname(require.resolve('json-schema-test-suite/package.json'));

// Documents the tests reference, given to every validator: the suite's remotes, which its runner serves at
// http://localhost:1234/ (leaving out the folders for other drafts), and the draft-07 meta-schema.
function loadRemotes() {
  const remotesDir = path.join(SUITE, 'remotes');
  const skip = /^(draft3|draft4|draft6|draft2019-09|draft2020-12|draft-next|v1)\b/;
  const walk = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
  const remotes = {};
  walk(remotesDir)
    .map((file) => path.relative(remotesDir, file).split(path.sep).join('/'))
    .filter((file) => file.endsWith('.json') && !skip.test(file))
    .forEach((file) => {
      remotes[`http://localhost:1234/${file}`] = JSON.parse(fs.readFileSync(path.join(remotesDir, file), 'utf8'));
    });
  // eslint-disable-next-line global-require -- the meta-schema file that ajv ships
  remotes['http://json-schema.org/draft-07/schema'] = require('ajv/dist/refs/json-schema-draft-07.json');
  return remotes;
}

// Every test group of the draft-07 suite, in a stable order: { file, description, schema, tests }.
function loadGroups() {
  const dir = path.join(SUITE, 'tests/draft7');
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
  loadRemotes,
  loadGroups,
  compileGroup,
  evaluate,
  commonGroups,
  suiteRun,
  summary,
};
