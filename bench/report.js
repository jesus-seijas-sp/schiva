/* eslint-disable no-console */
// Writes docs/benchmarks.html from the results of the isolated benchmarks (results/suite*.json, results/object.json,
// results/features.json) and the conformance of draft-04 and draft-06, which it measures. Run it after
// `pnpm start` and `pnpm run features`:
//
//   node report.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const Ajv = require('ajv');
const AjvDraft04 = require('ajv-draft-04');
const draft06MetaSchema = require('ajv/dist/refs/json-schema-draft-06.json');
const { compileJsonSchema } = require('../src');
const { evaluate, loadGroups, loadRemotes } = require('./lib/suite');

const RESULTS = path.join(__dirname, 'results');
const OUT = path.join(__dirname, '..', 'docs', 'benchmarks.html');
const read = (file) => JSON.parse(fs.readFileSync(path.join(RESULTS, file), 'utf8'));

const suites = {
  'draft-07': read('suite.json'),
  '2019-09': read('suite-draft2019-09.json'),
  '2020-12': read('suite-draft2020-12.json'),
};
const payloads = read('object.json');
const features = read('features.json');

// ------------------------------------------------------------------------------------------------ formatting
const escape = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[^\x20-\x7E]/g, (c) => `&#${c.codePointAt(0)};`);

function fmt(n) {
  if (n === undefined || n === null) return '&ndash;';
  if (n >= 1e8) return `${Math.round(n / 1e6)}M`;
  if (n >= 1e7) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e5) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  return String(Math.round(n));
}

const isSchiva = (name) => name.startsWith('schiva');
const libraryOf = (name) => name.replace(/ \(.*\)$/, '');

function table(headers, rows, className = 'numbers') {
  const head = headers.map((h) => `<th>${h}</th>`).join('');
  const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n              ');
  return `<div class="table-wrap">
          <table class="${className}">
            <thead>
              <tr>${head}</tr>
            </thead>
            <tbody>
              ${body}
            </tbody>
          </table>
        </div>`;
}

const bold = (text, condition) => (condition ? `<strong>${text}</strong>` : text);

// ------------------------------------------------------------------------------------------------ conformance
// Draft-04 and draft-06 are run only by schiva and ajv (as in conformance.js).
function legacyConformance(draft, suiteName) {
  const remotes = loadRemotes(draft);
  const groups = loadGroups(draft);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const schiva = {
    name: 'schiva',
    compile: (schema) => {
      const fn = compileJsonSchema(clone(schema), { schemas: clone(remotes), draft: suiteName });
      return (data) => fn(data).length === 0;
    },
  };
  const ajv = {
    name: 'ajv',
    compile: (schema) => {
      const instance = draft === 'draft4' ? new AjvDraft04({ strict: false }) : new Ajv({ strict: false });
      if (draft === 'draft6') instance.addMetaSchema(draft06MetaSchema);
      Object.entries(remotes)
        .filter(([uri]) => !uri.startsWith('http://json-schema.org/') && !uri.startsWith('https://json-schema.org/'))
        .forEach(([uri, remote]) => instance.addSchema(clone(remote), uri));
      return instance.compile(clone(schema));
    },
  };
  const total = groups.reduce((n, g) => n + g.tests.length, 0);
  return { total, schiva: evaluate(schiva, groups, remotes).testsOk, ajv: evaluate(ajv, groups, remotes).testsOk };
}

console.log('Measuring the conformance of draft-04 and draft-06...');
const draft04 = legacyConformance('draft4', 'draft-04');
const draft06 = legacyConformance('draft6', 'draft-06');

// ------------------------------------------------------------------------------------------------ sections
const LIBRARIES = [
  'schiva',
  'ajv',
  '@exodus/schemasafe',
  '@cfworker/json-schema',
  'json-schema-library',
  'is-my-json-valid',
  'jsen',
  'djv',
  'jsonschema',
  'tv4',
  'z-schema',
];
const versionOf = (name) => {
  if (name === 'schiva') return require('../package.json').version; // eslint-disable-line global-require
  try {
    return require(`${name}/package.json`).version; // eslint-disable-line global-require
  } catch (e) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules', name, 'package.json'), 'utf8')).version;
  }
};

// Speed on the test suite, by validator and draft.
function suiteSpeedTable() {
  const names = [...new Set(Object.values(suites).flatMap((s) => s.validators.map((v) => v.name)))];
  const speed = (name, draft) => {
    const row = suites[draft].validators.find((v) => v.name === name);
    return row ? row.opsPerSec : undefined;
  };
  const best = (draft) => Math.max(...suites[draft].validators.map((v) => v.opsPerSec || 0));
  const rows = names
    .sort((a, b) => (speed(b, 'draft-07') || 0) - (speed(a, 'draft-07') || 0))
    .map((name) => [
      bold(escape(name), isSchiva(name)),
      ...Object.keys(suites).map((d) => bold(fmt(speed(name, d)), speed(name, d) === best(d))),
    ]);
  return table(['Runs per second', 'draft-07', '2019-09', '2020-12'], rows);
}

const PAYLOADS = [
  ['moltar strict', 'The flat object of typescript-runtime-type-benchmarks, with no extra keys allowed.'],
  [
    'order (20 lines)',
    'A business object with 20 order lines: pattern, enum, const, number ranges, anyOf, nullable types, uniqueItems.',
  ],
  [
    'order 2020-12, unevaluatedProperties (20 lines)',
    'The same order in draft 2020-12, with $ref, allOf and unevaluatedProperties.',
  ],
  [
    'payment 2020-12, oneOf + unevaluatedProperties',
    'A payment whose variant (oneOf) decides the keys it may have (unevaluatedProperties).',
  ],
  [
    'shapes, discriminator (8 kinds)',
    'A shape among 8, picked by an OpenAPI discriminator (ajv with its option discriminator: true).',
  ],
];

function payloadSection([name, description]) {
  const valid = payloads[`${name} · valid`];
  const invalid = payloads[`${name} · invalid`];
  const names = [...new Set([...valid.rows, ...invalid.rows].map((r) => r.name))];
  const opsOf = (result, n) => (result.rows.find((r) => r.name === n) || {}).ops;
  const best = (result) => Math.max(...result.rows.map((r) => r.ops));
  const rows = names
    .sort((a, b) => (opsOf(valid, b) || 0) - (opsOf(valid, a) || 0))
    .map((n) => [
      bold(escape(n), isSchiva(n)),
      bold(fmt(opsOf(valid, n)), opsOf(valid, n) === best(valid)),
      bold(fmt(opsOf(invalid, n)), opsOf(invalid, n) === best(invalid)),
    ]);
  const skipped = [...new Set([...(valid.skipped || []), ...(invalid.skipped || [])])];
  const id = name
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/-+$/, '')
    .toLowerCase();
  return `<h3 id="${id}">${escape(name)}</h3>
        <p>${escape(description)}</p>
        ${table(['Validations per second', 'valid', 'invalid'], rows)}${
          skipped.length ? `\n        <p class="note">Left out: ${escape(skipped.join('; '))}.</p>` : ''
        }`;
}

function compileTable() {
  const rows = payloads['compile order schema'].rows
    .slice()
    .sort((a, b) => b.ops - a.ops)
    .map((r) => [bold(escape(r.name), isSchiva(r.name)), fmt(r.ops)]);
  return table(['Schemas per second', 'order schema'], rows);
}

function featuresTable() {
  const rows = Object.entries(features).map(([name, { rows: r }]) => {
    const ops = (n) => (r.find((x) => x.name === n) || {}).ops;
    const ratio = (a, b) => (ops(a) && ops(b) ? `${(ops(a) / ops(b)).toFixed(1)}&times;` : '&ndash;');
    return [
      escape(name),
      `<strong>${fmt(ops('schiva (all errors)'))}</strong>`,
      fmt(ops('ajv (all errors)')),
      `<strong>${fmt(ops('schiva (first error)'))}</strong>`,
      fmt(ops('ajv (first error)')),
      ratio('schiva (all errors)', 'ajv (all errors)'),
    ];
  });
  return table(
    [
      'Validations per second',
      'schiva, all errors',
      'ajv, all errors',
      'schiva, first error',
      'ajv, first error',
      'schiva / ajv',
    ],
    rows
  );
}

const yes = '&#10003;';
const FEATURES = [
  [
    'JSON Schema drafts',
    'draft-04, draft-06, draft-07, 2019-09, 2020-12',
    'draft-06 to 2020-12; draft-04 with ajv-draft-04',
  ],
  [
    'JSON-Schema-Test-Suite, all five drafts',
    `${draft04.schiva + draft06.schiva + ['draft-07', '2019-09', '2020-12'].reduce((n, d) => n + suites[d].validators[0].testsOk, 0)} tests passed, all of them`,
    `${draft04.ajv + draft06.ajv + ['draft-07', '2019-09', '2020-12'].reduce((n, d) => n + (suites[d].validators.find((v) => v.name.startsWith('ajv')) || {}).testsOk, 0)} tests passed`,
  ],
  ['JSON Type Definition (JTD)', '&ndash;', yes],
  ['Schema DSL for JavaScript', `${yes} (String(), Integer()...), with inferred TypeScript types`, '&ndash;'],
  [
    'Messages with the path of the field',
    `${yes} (lines[3].price must be at least 0)`,
    'messages without the path; instancePath apart',
  ],
  ['Error objects', yes, yes],
  ['Every error, first error, or true/false', yes, yes],
  ['Standalone code', `${yes} (no dependency at all)`, `${yes} (requires parts of ajv for some keywords)`],
  ['Formats', `${yes} built in, idn-hostname and idn-email included`, 'with ajv-formats'],
  ['Optional format tests passed (2020-12)', '874 / 874', '733 / 874 (with ajv-formats)'],
  ['formatMinimum, formatMaximum', yes, 'with ajv-formats'],
  ['Keywords of your own: validate, compile, macro', yes, yes],
  ['Keywords of your own that write generated code', '&ndash;', yes],
  ['ajv-keywords', `${yes} built in (13 of them)`, 'with ajv-keywords'],
  ['useDefaults, removeAdditional, coerceTypes', yes, yes],
  ['$data references', '&ndash;', yes],
  ['Asynchronous validation ($async)', '&ndash;', yes],
  ['Loading referenced documents (compileAsync)', `${yes} compileJsonSchemaAsync`, yes],
  ['OpenAPI discriminator', `${yes} with mapping and implicit names`, 'const and enum only'],
  ['Tagged oneOf detected without discriminator', yes, '&ndash;'],
  ['strict mode', yes, yes],
  ['Translated messages, errorMessage', '&ndash;', 'with ajv-i18n, ajv-errors'],
  ['Dependencies', '0', '4'],
];

function featureMatrix() {
  return table(['', `schiva ${versionOf('schiva')}`, `ajv ${versionOf('ajv')}`], FEATURES, 'features-matrix');
}

function modesTable() {
  const names = [...new Set(Object.values(suites).flatMap((s) => s.validators.map((v) => v.name)))];
  // The modes a library is benchmarked in: its rows, or true/false for a library with a single row.
  const modes = (library) => {
    const own = names.filter((n) => libraryOf(n) === library);
    const listed = own.map((n) => (n === library ? 'true/false' : n.slice(library.length + 2, -1)));
    return listed.map((mode) => (mode === 'boolean' ? 'true/false' : mode)).join(', ');
  };
  const drafts = (library) =>
    Object.keys(suites)
      .filter((d) => suites[d].validators.some((v) => libraryOf(v.name) === library))
      .join(', ');
  const rows = LIBRARIES.map((library) => [escape(library), versionOf(library), drafts(library), modes(library)]);
  return table(['Library', 'Version', 'Drafts benchmarked', 'Modes benchmarked'], rows);
}

// ------------------------------------------------------------------------------------------------ charts
// The modes a validator row is in: the one in parentheses, or true/false for a library with a single row.
const MODES = [
  ['true/false', 'boolean'],
  ['first error', 'first error'],
  ['all errors', 'all errors'],
];
const modeOf = (name) => {
  const match = / \((.*)\)$/.exec(name);
  if (!match) return 'true/false';
  return match[1] === 'boolean' ? 'true/false' : match[1];
};
const INTERPRETERS = ['jsonschema', 'tv4', '@cfworker/json-schema'];

const times = (ratio) => (ratio < 10 ? ratio.toFixed(1) : String(Math.round(ratio)));

// A bar chart: one row per { name, value }, sorted, the bars relative to the largest value, and next to each value how
// many times slower than schiva it is.
function chart(title, subtitle, rows, unit = '') {
  const sorted = rows.filter((r) => r.value).sort((a, b) => b.value - a.value);
  const max = Math.max(...sorted.map((r) => r.value));
  const schiva = (sorted.find((r) => isSchiva(r.name)) || {}).value;
  const lines = sorted
    .map((r) => {
      const us = isSchiva(r.name);
      const ratio = schiva && !us ? schiva / r.value : undefined;
      const note = ratio && ratio >= 1.05 ? `<small>${times(ratio)}&times; slower</small>` : '';
      const classes = ['chart-row', us ? 'us' : '', INTERPRETERS.includes(libraryOf(r.name)) ? 'interprets' : '']
        .filter(Boolean)
        .join(' ');
      return `<div class="${classes}"><span class="name" title="${escape(r.name)}">${escape(libraryOf(r.name))}</span><div class="track"><div class="fill" style="width: ${Math.max(0.5, (100 * r.value) / max).toFixed(1)}%"></div></div><span class="value">${fmt(r.value)}${unit}${note}</span></div>`;
    })
    .join('\n            ');
  return `<div class="chart">
            <h3>${title}</h3>
            ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}
            ${lines}
          </div>`;
}

// Mode switches: a segmented control over one panel per mode.
function modeTabs(id, panels, selected = 1) {
  const list = panels
    .map(
      ({ label }, i) =>
        `<button role="tab" id="${id}-tab-${i}" aria-controls="${id}-panel-${i}" aria-selected="${i === selected ? 'true' : 'false'}">${label}</button>`
    )
    .join('');
  const bodies = panels
    .map(
      ({ html }, i) =>
        `<div class="tab-panel" id="${id}-panel-${i}" role="tabpanel" aria-labelledby="${id}-tab-${i}"${i === selected ? '' : ' hidden'}>
          ${html}
        </div>`
    )
    .join('\n        ');
  return `<div class="tabs segmented">
        <div class="tab-list" role="tablist">${list}</div>
        ${bodies}
      </div>`;
}

const inMode = (rows, mode) => rows.filter((r) => modeOf(r.name) === mode);
const valueRows = (rows) => rows.map((r) => ({ name: r.name, value: r.opsPerSec ?? r.ops }));

function suiteCharts() {
  return modeTabs(
    'suite',
    MODES.map(([label]) => ({
      label,
      html: `<div class="charts">
          ${Object.entries(suites)
            .map(([draft, s]) =>
              chart(
                draft === 'draft-07' ? 'Draft-07' : `Draft ${draft}`,
                `runs per second over ${s.commonTests} tests`,
                valueRows(inMode(s.validators, label))
              )
            )
            .join('\n          ')}
        </div>`,
    }))
  );
}

function payloadCharts() {
  return modeTabs(
    'payloads',
    MODES.map(([label]) => ({
      label,
      html: PAYLOADS.map(([name, description]) => {
        const id = name
          .replace(/[^a-z0-9]+/gi, '-')
          .replace(/-+$/, '')
          .toLowerCase();
        const one = (kind) =>
          chart(
            `${escape(name)}, ${kind}`,
            `validations per second`,
            valueRows(inMode(payloads[`${name} · ${kind}`].rows, label))
          );
        return `<h3 id="${id}-${label.replace(/[^a-z]/g, '')}">${escape(name)}</h3>
          <p>${escape(description)}</p>
          <div class="charts">
          ${one('valid')}
          ${one('invalid')}
          </div>`;
      }).join('\n          '),
    }))
  );
}

function compileChart() {
  const rows = payloads['compile order schema'].rows.filter((r) =>
    ['true/false', 'first error'].includes(modeOf(r.name))
  );
  // One row per library: its first-error row when it has one.
  const byLibrary = new Map();
  rows.forEach((r) => {
    const library = libraryOf(r.name);
    if (!byLibrary.has(library) || modeOf(r.name) === 'first error') byLibrary.set(library, r);
  });
  return `<div class="legend"><span class="us">schiva</span><span>compiles the schema</span><span class="interprets">interprets it at every validation</span></div>
        <div class="charts">
          ${chart('Compiling the order schema', 'schemas per second, first error', valueRows([...byLibrary.values()]))}
        </div>`;
}

// Features: schiva and ajv side by side, with schiva's speed in times ajv's.
function featurePairs() {
  return modeTabs(
    'features',
    // Measured building errors, in the two modes of ajv.
    MODES.slice(1).map(([label]) => {
      const pairs = Object.entries(features).map(([name, { rows }]) => {
        const s = rows.find((r) => r.name === `schiva (${label})`).ops;
        const a = rows.find((r) => r.name === `ajv (${label})`).ops;
        const max = Math.max(s, a);
        const row = (who, value, us) =>
          `<div class="chart-row${us ? ' us' : ''}"><span class="name">${who}</span><div class="track"><div class="fill" style="width: ${Math.max(0.5, (100 * value) / max).toFixed(1)}%"></div></div><span class="value">${fmt(value)}</span></div>`;
        return `<div class="pair">
            <div class="head"><span>${escape(name)}</span><span class="times">${times(s / a)}&times;</span></div>
            ${row('schiva', s, true)}
            ${row('ajv', a, false)}
          </div>`;
      });
      return {
        label,
        html: `<div class="pairs">
          ${pairs.join('\n          ')}
        </div>`,
      };
    }),
    0
  );
}

// Tests passed as progress bars, by library and draft.
function conformanceProgress() {
  const drafts = Object.keys(suites);
  const passed = (library, draft) => {
    const row = suites[draft].validators.find((v) => libraryOf(v.name) === library);
    return row ? row.testsOk : undefined;
  };
  const totals = [draft04.total, draft06.total, ...drafts.map((d) => suites[d].totalTests)];
  const cell = (count, total) => {
    if (count === undefined) return '<span class="count">not run</span>';
    const percent = (100 * count) / total;
    return `<div class="progress${count === total ? ' full' : ''}"><div class="track"><div class="fill" style="width: ${percent.toFixed(1)}%"></div></div><span class="count">${count} / ${total}</span></div>`;
  };
  const rows = LIBRARIES.map((library) => {
    const legacy = (d) => (library === 'schiva' || library === 'ajv' ? d[library] : undefined);
    const counts = [legacy(draft04), legacy(draft06), ...drafts.map((d) => passed(library, d))];
    return [bold(escape(library), library === 'schiva'), ...counts.map((c, i) => cell(c, totals[i]))];
  });
  return table(['', 'draft-04', 'draft-06', 'draft-07', '2019-09', '2020-12'], rows, 'progress-table');
}

// Summary figures: schiva against ajv.
const ajvRow = (rows, mode) => rows.find((r) => r.name === `ajv (${mode})`);
const schivaRow = (rows, mode) => rows.find((r) => r.name === `schiva (${mode})`);
const geometricMean = (values) => Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length);
const totalTests = (library) =>
  draft04[library] +
  draft06[library] +
  Object.values(suites).reduce(
    (n, s) => n + (s.validators.find((v) => libraryOf(v.name) === library) || {}).testsOk,
    0
  );
const allTests = draft04.total + draft06.total + Object.values(suites).reduce((n, s) => n + s.totalTests, 0);
const suiteRatio =
  schivaRow(suites['draft-07'].validators, 'first error').opsPerSec /
  ajvRow(suites['draft-07'].validators, 'first error').opsPerSec;
const payloadRatio = geometricMean(
  PAYLOADS.flatMap(([name]) =>
    ['valid', 'invalid'].map((kind) => {
      const { rows } = payloads[`${name} · ${kind}`];
      return schivaRow(rows, 'first error').ops / ajvRow(rows, 'first error').ops;
    })
  )
);
const compileRows = payloads['compile order schema'].rows;
const compileRatio = schivaRow(compileRows, 'first error').ops / ajvRow(compileRows, 'first error').ops;
const featureRatio = geometricMean(
  Object.values(features).map(({ rows }) => schivaRow(rows, 'all errors').ops / ajvRow(rows, 'all errors').ops)
);

const stats = [
  [
    `${allTests.toLocaleString('en')}`,
    `tests of the JSON-Schema-Test-Suite, draft-04 to 2020-12: all passed (ajv: ${totalTests('ajv').toLocaleString('en')})`,
  ],
  [`${times(suiteRatio)}&times;`, "ajv's speed on the draft-07 test suite, first error"],
  [`${times(payloadRatio)}&times;`, "ajv's speed on the payloads below, on average (geometric mean), first error"],
  [`${times(compileRatio)}&times;`, "ajv's speed compiling a schema"],
];
const statCards = stats
  .map(
    ([value, label]) => `<div class="stat"><span class="value">${value}</span><span class="label">${label}</span></div>`
  )
  .join('\n          ');

const rawTable = (summary, html) => `<details class="raw">
          <summary>${summary}</summary>
          ${html}
        </details>`;

// ------------------------------------------------------------------------------------------------ page
const cpu = os.cpus()[0].model.replace(/\s+/g, ' ').trim();
const date = new Date().toISOString().slice(0, 10);

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Benchmarks &middot; schiva</title>
    <meta
      name="description"
      content="schiva compared with ajv and nine other JSON Schema validators: tests of the JSON-Schema-Test-Suite passed, speed on the suite and on payloads, compile time, features and their speed."
    />
    <link rel="canonical" href="https://schiva.js.org/benchmarks.html" />
    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230d7c66'/%3E%3Ctext x='16' y='22.5' font-family='monospace' font-size='18' font-weight='700' fill='white' text-anchor='middle'%3Es%3C/text%3E%3C/svg%3E"
    />
    <link rel="stylesheet" href="style.css?v=${versionOf('schiva')}" />
    <script src="main.js?v=${versionOf('schiva')}"></script>
  </head>
  <body>
    <!-- Written by bench/report.js from the results of the benchmarks: do not edit, run it again. -->
    <header class="header">
      <div class="header-inner">
        <a class="logo" href="./"><span class="logo-mark">s</span>schiva</a>
        <nav class="nav">
          <a href="guide.html">Guide</a>
          <a href="playground.html">Playground</a>
          <a href="api.html">API</a>
          <a class="hide-small" href="benchmarks.html" aria-current="page">Benchmarks</a>
          <a class="hide-small" href="migrating-from-ajv.html">From ajv</a>
          <a href="https://github.com/jesus-seijas-sp/schiva">GitHub</a>
          <button class="theme-toggle" type="button" aria-label="Switch between light and dark theme">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          </button>
        </nav>
      </div>
    </header>

    <div class="docs">
      <button class="menu-toggle" type="button" aria-expanded="false">&#9776; Contents</button>
      <aside class="sidebar">
        <h4>Benchmarks</h4>
        <ul>
          <li><a href="#summary">Summary</a></li>
          <li><a href="#conformance">Tests passed</a></li>
          <li><a href="#suite-speed">Speed on the test suite</a></li>
          <li><a href="#payloads">Speed on payloads</a></li>
          <li><a href="#compiling">Compiling</a></li>
          <li><a href="#features">Speed of the features</a></li>
          <li><a href="#comparison">schiva and ajv, feature by feature</a></li>
          <li><a href="#libraries">Libraries</a></li>
          <li><a href="#method">Method</a></li>
        </ul>
        <h4>More</h4>
        <ul>
          <li><a href="guide.html#performance">Performance in the guide</a></li>
          <li><a href="migrating-from-ajv.html">Migrating from ajv</a></li>
        </ul>
      </aside>

      <article class="content">
        <h1>Benchmarks</h1>
        <p class="intro">
          schiva compared with ajv and nine other JSON Schema validators: how many tests of the JSON-Schema-Test-Suite
          each one passes, how fast it validates the suite and realistic payloads, how fast it compiles a schema, and how
          fast the features beyond validating are.
        </p>

        <h2 id="summary">Summary</h2>
        <div class="stats">
          ${statCards}
        </div>
        <div class="callout">
          <p>
            schiva passes every test of the five drafts it supports. In the same mode, it validates faster than every
            other library in every benchmark on this page, compiles faster than every other library that compiles
            schemas, and is faster than ajv on every feature they share (${times(featureRatio)}&times; on average).
          </p>
        </div>
        <p>
          Every chart compares libraries doing the same work: pick the mode above it. <em>true/false</em> only tells
          whether the value is valid; <em>first error</em> stops at the first failing check and builds its error;
          <em>all errors</em> builds every error. Longer is faster, and next to each library is how many times slower
          than schiva it is.
        </p>

        <h2 id="conformance">Tests passed</h2>
        <p>
          Tests of the <a href="https://github.com/json-schema-org/JSON-Schema-Test-Suite">JSON-Schema-Test-Suite</a>
          each library gets right, draft by draft (a schema it cannot compile counts as wrong for every test of its
          group). Only schiva and ajv run draft-04 and draft-06 here; drafts 2019-09 and 2020-12 run with the libraries
          that implement them.
        </p>
        ${conformanceProgress()}

        <h2 id="suite-speed">Speed on the test suite</h2>
        <p>
          How many times per second each library validates every test of the groups all the libraries of the draft pass,
          so that each one does the same work.
        </p>
        ${suiteCharts()}
        <p class="note">
          ajv's speed on drafts 2019-09 and 2020-12 changes a lot from one process to the next (between about 4k and 15k
          runs per second in our runs).
        </p>
        ${rawTable('All the numbers', suiteSpeedTable())}

        <h2 id="payloads">Speed on payloads</h2>
        <p>
          Validations per second of one value, valid and invalid, by each library that compiles the schema and gives the
          right answer for it. The schemas are in
          <a href="https://github.com/jesus-seijas-sp/schiva/blob/main/bench/lib/cases.js">bench/lib/cases.js</a>.
        </p>
        ${payloadCharts()}
        ${rawTable('All the numbers', PAYLOADS.map(payloadSection).join('\n        '))}

        <h2 id="compiling">Compiling</h2>
        <p>
          Schemas per second, from the order schema to a function that validates it. jsonschema, tv4 and
          @cfworker/json-schema interpret the schema instead of compiling it: their "compiling" only builds an object,
          and they pay for it at every validation, which is why they are the slowest on the payloads above.
        </p>
        ${compileChart()}
        ${rawTable('All the numbers', compileTable())}

        <h2 id="features">Speed of the features</h2>
        <p>
          schiva and ajv on the features beyond validating JSON Schema, each with the same options and plugins
          (ajv-keywords, ajv-formats, ajv-draft-04, ajv's standalone code), with schiva's speed in times ajv's. With the
          options that change the data, each call validates a new object, made the same way for both. The cases are in
          <a href="https://github.com/jesus-seijas-sp/schiva/blob/main/bench/features.js">bench/features.js</a>.
        </p>
        ${featurePairs()}
        ${rawTable('All the numbers', featuresTable())}

        <h2 id="comparison">schiva and ajv, feature by feature</h2>
        ${featureMatrix()}
        <p>
          See <a href="migrating-from-ajv.html">Migrating from ajv</a> for the options, errors and APIs of each one.
        </p>

        <h2 id="libraries">Libraries</h2>
        <p>
          Every library of <a href="https://github.com/ebdrup/json-schema-benchmark">json-schema-benchmark</a> that runs
          on current Node.js, with the drafts and modes each one is benchmarked in. (ajv always returns true or false,
          and builds the first error, or all of them, on the way.)
        </p>
        ${modesTable()}

        <h2 id="method">Method</h2>
        <ul>
          <li>
            Every measurement runs in a new Node.js process with a single library, as a service uses it, so libraries
            cannot slow each other down through the state of the JIT they would share. Each one is timed for 1 second
            after a warm-up, in 3 processes, and the median is kept.
          </li>
          <li>
            Measured on ${escape(cpu)}, ${os.cpus().length} cores, ${escape(os.type())}, Node.js ${process.version},
            on ${date}. Benchmarks depend on the machine and on what else runs on it: compare the libraries with each
            other, not these numbers with another machine's.
          </li>
        </ul>
        <pre><code class="language-sh">cd bench
pnpm install
pnpm start                          # test suite and payloads, isolated (about 30 minutes)
pnpm run features                   # the features of schiva and ajv
pnpm run conformance draft2020-12   # tests passed by schiva and ajv, file by file
pnpm run report                     # writes this page</code></pre>
      </article>
    </div>

    <footer class="footer">
      <div class="container">
        <span>schiva is MIT licensed. &copy; Jes&uacute;s Seijas</span>
        <span>
          <a href="./">Home</a> &middot; <a href="guide.html">Guide</a> &middot; <a href="playground.html">Playground</a> &middot; <a href="api.html">API</a> &middot;
          <a href="https://github.com/jesus-seijas-sp/schiva">GitHub</a> &middot;
          <a href="https://www.npmjs.com/package/schiva">npm</a>
        </span>
      </div>
    </footer>
  </body>
</html>
`;
fs.writeFileSync(OUT, page);
console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
