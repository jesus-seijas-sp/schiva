/* eslint-disable no-console */
// Quick mode: the payloads of lib/cases.js validated by every validator, and the compile cost, with every validator in
// this one process (see isolated.js for the default mode).
const fs = require('fs');
const path = require('path');
const { Bench } = require('tinybench');
const validators = require('./validators');
const { cases, compileCase, prepareCase } = require('./lib/cases');

async function runCase(c) {
  const bench = new Bench({ time: 1000, warmupTime: 200 });
  const skipped = [];
  validators.forEach((v) => {
    const { fn, skipped: reason } = prepareCase(v, c);
    if (reason) {
      skipped.push(reason);
    } else {
      bench.add(v.name, () => fn(c.data));
    }
  });
  await bench.run();
  const result = {
    skipped,
    rows: bench.tasks.map((t) => ({ name: t.name, ops: t.result.throughput.mean, spread: t.result.latency.rme })),
  };
  console.log(`\n## ${c.name}`);
  if (skipped.length) console.log('skipped:', skipped.join(' | '));
  console.table(
    result.rows
      .sort((a, b) => b.ops - a.ops)
      .map((r) => ({ validator: r.name, 'ops/sec': Math.round(r.ops), '±%': r.spread.toFixed(2) }))
  );
  return result;
}

(async () => {
  console.log('Quick mode (one process).');
  const results = {};
  // Cases run one after the other so benchmarks do not compete for the CPU.
  await cases.reduce(
    (previous, c) =>
      previous.then(async () => {
        results[c.name] = await runCase(c);
      }),
    Promise.resolve()
  );

  const cbench = new Bench({ time: 1000, warmupTime: 200 });
  validators.forEach((v) => {
    try {
      v.compile(compileCase.schema);
      cbench.add(v.name, () => v.compile(compileCase.schema));
    } catch (e) {
      /* skip */
    }
  });
  await cbench.run();
  results[compileCase.name] = {
    rows: cbench.tasks.map((t) => ({ name: t.name, ops: t.result.throughput.mean, spread: t.result.latency.rme })),
  };
  console.log(`\n## ${compileCase.name}`);
  console.table(
    results[compileCase.name].rows
      .sort((a, b) => b.ops - a.ops)
      .map((r) => ({ validator: r.name, 'compiles/sec': Math.round(r.ops), '±%': r.spread.toFixed(2) }))
  );
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', 'object-quick.json'), JSON.stringify(results, null, 2));
})();
