// Timing shared by the isolated benchmarks: calls per second of a function, and the median of several child
// processes, each timing one function on its own.
const { execFileSync } = require('child_process');

const RUNS = Number(process.env.BENCH_RUNS) || 3;
const TIME = Number(process.env.BENCH_TIME) || 1000;
const WARMUP = Math.max(200, TIME / 3);

// Calls per second of `fn`, timed for TIME ms after a warm-up. Calls are made in batches that take at least 1 ms, so
// reading the clock does not weigh on fast functions and slow ones still stop on time.
function measure(fn) {
  const now = () => Number(process.hrtime.bigint()) / 1e6;
  let batch = 1;
  for (;;) {
    const start = now();
    for (let i = 0; i < batch; i += 1) fn();
    if (now() - start >= 1 || batch >= 2 ** 24) break;
    batch *= 2;
  }
  const warmupEnd = now() + WARMUP;
  while (now() < warmupEnd) for (let i = 0; i < batch; i += 1) fn();
  let count = 0;
  const start = now();
  let end;
  do {
    for (let i = 0; i < batch; i += 1) fn();
    count += batch;
    end = now();
  } while (end - start < TIME);
  return (count * 1000) / (end - start);
}

// Median, and spread as the percentage between the lowest and highest run, over RUNS child processes of `script`
// (node script --child ...args), each printing the calls per second of one measurement.
function runChildren(script, args) {
  const values = Array.from({ length: RUNS }, () =>
    Number(
      execFileSync(process.execPath, ['--no-deprecation', script, '--child', ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    )
  ).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  return { opsPerSec: median, spread: (100 * (values[values.length - 1] - values[0])) / median };
}

module.exports = {
  RUNS,
  measure,
  runChildren,
};
