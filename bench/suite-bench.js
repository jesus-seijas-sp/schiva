/* eslint-disable no-console */
// Quick mode: conformance against JSON-Schema-Test-Suite (draft-07), and runs/sec over the test groups every validator
// passes, with every validator in this one process (see isolated.js for the default mode).
const fs = require('fs');
const path = require('path');
const { Bench } = require('tinybench');
const validators = require('./validators');
const { loadRemotes, loadGroups, evaluate, commonGroups, suiteRun, summary } = require('./lib/suite');

const RESULTS = path.join(__dirname, 'results');

(async () => {
  const remotes = loadRemotes();
  const groups = loadGroups();
  const results = validators.map((validator) => ({ validator, ...evaluate(validator, groups, remotes) }));
  const common = commonGroups(results);

  const bench = new Bench({ time: 1500, warmupTime: 300 });
  results.forEach((r) => {
    const fns = common.map((gi) => r.passed.find((p) => p.gi === gi).fn);
    bench.add(r.validator.name, suiteRun(fns, groups, common));
  });
  await bench.run();

  const speed = Object.fromEntries(
    bench.tasks.map((t) => [t.name, { opsPerSec: t.result.throughput.mean, spread: t.result.latency.rme }])
  );
  const out = summary(groups, results, common, speed, 'quick');
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'suite-quick.json'), JSON.stringify(out, null, 2));
  console.log(
    `Quick mode (one process). Groups ${out.totalGroups}, tests ${out.totalTests}; ` +
      `speed set: ${out.commonGroups} groups / ${out.commonTests} tests`
  );
  console.table(
    out.validators
      .sort((a, b) => b.opsPerSec - a.opsPerSec)
      .map((x) => ({
        validator: x.name,
        'runs/sec': Math.round(x.opsPerSec),
        '±%': x.spread.toFixed(2),
        'tests ok': x.testsOk,
        wrong: x.testsFail - x.unsupported,
        unsupported: x.unsupported,
        groups: x.groupsPassed,
      }))
  );
})();
