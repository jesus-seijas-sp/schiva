# Schema validator benchmark

Compares `compileJsonSchema` from schiva (`../src`) with ajv and the other validators in
[json-schema-benchmark](https://github.com/ebdrup/json-schema-benchmark).

This folder has its own `package.json`, so the validators it compares are not dependencies of the library.

```sh
cd bench
pnpm install
pnpm start               # both benchmarks, isolated (default, about 8 minutes)
pnpm run suite           # JSON-Schema-Test-Suite only, isolated
pnpm run object          # realistic payloads only, isolated
pnpm run quick           # both benchmarks, every validator in one process (about a minute)
pnpm run quick:suite
pnpm run quick:object
```

Raw numbers are written to `bench/results/` (git-ignored): `suite.json` and `object.json` for the isolated mode,
`suite-quick.json` and `object-quick.json` for the quick one.

## Modes

- **Isolated (default, `isolated.js`)**: every measurement runs in a fresh process with a single validator, the way a
  service uses a validator, so validators cannot slow each other down through the JIT state they would share in one
  process. Each measurement is repeated in 3 processes and the median is reported, with the spread between the
  lowest and highest run. `BENCH_RUNS` and `BENCH_TIME` (ms per run, default 1000) change that.
- **Quick (`suite-bench.js`, `object-bench.js`)**: every validator in the same process, measured with tinybench. It
  is faster to run and also shows how the validators behave when many run side by side, but it compresses the
  differences between them and depends on the order they run in. Use it while developing, and the isolated mode for
  the numbers to compare.

## Benchmarks

- **Suite**: runs the draft-07 [JSON-Schema-Test-Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite),
  pinned to a commit in `package.json`. It reports how many tests each validator gets right, wrong, or rejects at
  compile time ("unsupported"), and the groups it fully passes. Speed is measured over the test groups that every
  validator passes, so all of them do the same work.
- **Payloads** (`lib/cases.js`): validates the same schema with every validator.
  - **moltar**: the flat object from typescript-runtime-type-benchmarks, with no extra keys allowed.
  - **order**: a business-style object with 20 order lines, using `pattern`, `enum`, `const`, number ranges,
    `anyOf`, nullable types and `uniqueItems`.

  Each payload is run valid and invalid. It also measures compile cost (schema to validator). A validator that
  fails to compile a schema, or gives the wrong answer for it, is skipped for that case.

`validators.js` holds one adapter per library; add a library there to include it in every benchmark. `lib/` holds
what both modes share: the payloads, and loading the suite with its remote documents.

## Reading the numbers

- Validators with several modes have one row per mode; only compare rows that do the same work:
  - **(boolean)** only tells whether the data is valid: `compileJsonSchema(schema, { errors: false })`, schemasafe's
    default.
  - **(first error)** stops at the first failing check and builds its error: `{ allErrors: false }`, ajv's default,
    schemasafe with `includeErrors`.
  - **(all errors)** builds every error: schiva's default, ajv and schemasafe with `allErrors`.

  Libraries with a single row (jsen, is-my-json-valid, djv...) run in their default mode.
- About 40% of the suite tests have invalid data, so building errors weighs a lot in the suite speed.
- schiva compiles the schema to generated code for the check and the error messages (see `src/compile.js`).
- Every validator gets the documents the tests reference through `$ref`: the suite's `remotes/` folder (under
  `http://localhost:1234/`, as the suite's own runner serves it) and the draft-07 meta-schema, registered with each
  library's own API (`schemas` options, `addSchema`, `setRemoteReference`...). schiva takes them with
  `compileJsonSchema(schema, { schemas })`.
