/* eslint-disable no-console */
// Default mode: every measurement runs in a fresh process with a single validator, as a service would use it, so
// validators cannot slow each other down through the shared JIT state of one process. Each measurement is repeated
// in BENCH_RUNS processes (default 3) of BENCH_TIME ms (default 1000), and the median is reported.
//
//   node isolated.js [suite|object] [draft]    runs both when no benchmark is given
//
// The suite benchmark runs the JSON-Schema-Test-Suite of draft-07, 2019-09 and 2020-12, or of the draft given
// (draft7, draft2019-09 or draft2020-12), each with the validators that implement it.
//
// The child processes are started by this script: node isolated.js --child <kind> <arguments...>
const fs = require('fs');
const path = require('path');
const validators = require('./validators');
const { RUNS, measure, runChildren: runMeasured } = require('./lib/measure');

const { forDraft } = validators;
const { cases, compileCase, prepareCase } = require('./lib/cases');
const { loadRemotes, loadGroups, compileGroup, evaluate, commonGroups, suiteRun, summary } = require('./lib/suite');

const RESULTS = path.join(__dirname, 'results');

// Child process: prints the calls per second of one measurement.
function child(kind, args) {
  let fn;
  if (kind === 'suite') {
    const [draft, validatorIndex, indexes] = args;
    const validator = forDraft(draft)[Number(validatorIndex)];
    const common = indexes.split(',').map(Number);
    const groups = loadGroups(draft);
    const remotes = loadRemotes(draft);
    const fns = common.map((gi) => compileGroup(validator, groups[gi], remotes));
    fn = suiteRun(fns, groups, common);
  } else if (kind === 'payload') {
    const [caseIndex, validatorIndex] = args.map(Number);
    const c = cases[caseIndex];
    const validate = prepareCase(forDraft(c.draft)[validatorIndex], c).fn;
    fn = () => validate(c.data);
  } else {
    const validator = validators[Number(args[0])];
    fn = () => validator.compile(compileCase.schema);
  }
  console.log(measure(fn));
}

// Median and spread of the measurement of these arguments in child processes (see lib/measure.js).
const runChildren = (args) => runMeasured(__filename, args);

function suite(draft) {
  const remotes = loadRemotes(draft);
  const groups = loadGroups(draft);
  const draftValidators = forDraft(draft);
  const results = draftValidators.map((validator) => ({ validator, ...evaluate(validator, groups, remotes) }));
  const common = commonGroups(results);
  console.log(
    `
# ${draft}
Isolated mode (one process per measurement, median of ${RUNS}). Groups ${groups.length}; ` +
      `speed set: ${common.length} groups`
  );
  const speed = {};
  draftValidators.forEach((validator, i) => {
    speed[validator.name] = runChildren(['suite', draft, String(i), common.join(',')]);
    console.log(`  ${validator.name}: ${Math.round(speed[validator.name].opsPerSec)} runs/sec`);
  });
  const out = summary(groups, results, common, speed, 'isolated');
  fs.mkdirSync(RESULTS, { recursive: true });
  const file = draft === 'draft7' ? 'suite.json' : `suite-${draft}.json`;
  fs.writeFileSync(path.join(RESULTS, file), JSON.stringify({ draft, ...out }, null, 2));
  console.log(`Tests ${out.totalTests}; speed set: ${out.commonGroups} groups / ${out.commonTests} tests`);
  console.table(
    out.validators
      .sort((a, b) => b.opsPerSec - a.opsPerSec)
      .map((x) => ({
        validator: x.name,
        'runs/sec': Math.round(x.opsPerSec),
        'spread %': x.spread.toFixed(1),
        'tests ok': x.testsOk,
        wrong: x.testsFail - x.unsupported,
        unsupported: x.unsupported,
        groups: x.groupsPassed,
      }))
  );
}

function payloads() {
  console.log(`\nIsolated mode (one process per measurement, median of ${RUNS}).`);
  const results = {};
  cases.forEach((c, ci) => {
    const skipped = [];
    const rows = [];
    forDraft(c.draft).forEach((validator, vi) => {
      const { skipped: reason } = prepareCase(validator, c);
      if (reason) {
        skipped.push(reason);
      } else {
        const { opsPerSec, spread } = runChildren(['payload', String(ci), String(vi)]);
        rows.push({ name: validator.name, ops: opsPerSec, spread });
      }
    });
    results[c.name] = { skipped, rows };
    console.log(`\n## ${c.name}`);
    if (skipped.length) console.log('skipped:', skipped.join(' | '));
    console.table(
      [...rows]
        .sort((a, b) => b.ops - a.ops)
        .map((r) => ({ validator: r.name, 'ops/sec': Math.round(r.ops), 'spread %': r.spread.toFixed(1) }))
    );
  });
  const rows = [];
  validators.forEach((validator, vi) => {
    try {
      validator.compile(compileCase.schema);
    } catch (e) {
      return;
    }
    const { opsPerSec, spread } = runChildren(['compile', String(vi)]);
    rows.push({ name: validator.name, ops: opsPerSec, spread });
  });
  results[compileCase.name] = { rows };
  console.log(`\n## ${compileCase.name}`);
  console.table(
    [...rows]
      .sort((a, b) => b.ops - a.ops)
      .map((r) => ({ validator: r.name, 'compiles/sec': Math.round(r.ops), 'spread %': r.spread.toFixed(1) }))
  );
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'object.json'), JSON.stringify(results, null, 2));
}

const [first, ...rest] = process.argv.slice(2);
if (first === '--child') {
  child(rest[0], rest.slice(1));
} else {
  if (!first || first === 'suite') (rest[0] ? [rest[0]] : validators.SPEED_DRAFTS).forEach(suite);
  if (!first || first === 'object') payloads();
}
