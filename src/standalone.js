// Standalone code: compiled validators written out as JavaScript source, to save to a file when building and load like
// any module. Loading it generates no code (no new Function), so it runs under a strict Content Security Policy and
// where code generation is disabled, and it needs nothing else: the helpers it calls are written into it.
const { generateSource } = require('./compile');
const { fromJsonSchema } = require('./json-schema');
const { deepEqual } = require('./deep-equal');
const { codePointLength } = require('./types/code-point-length');
const { hasDuplicates } = require('./types/has-duplicates');
const { isPlainObject, toType } = require('./types/validate-type');
const { HELPER_SOURCES } = require('./standalone-helpers');
const { FORMAT_FUNCTIONS } = require('./formats');
const { errorObject, pathName } = require('./error-objects');
const { version } = require('../package.json');

// Library functions the generated code calls, by the name their source (standalone-helpers.js) defines: the helpers
// of the checks, and the functions of the formats.
const HELPERS = new Map([
  [codePointLength, 'codePointLength'],
  [deepEqual, 'deepEqual'],
  [hasDuplicates, 'hasDuplicates'],
  [pathName, 'pathName'],
  [errorObject, 'errorObject'],
  ...Object.entries(FORMAT_FUNCTIONS).map(([name, fn]) => [fn, name]),
]);

const RESERVED = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends false finally for ' +
    'function if import in instanceof new null return super switch this throw true try typeof var void while with ' +
    'yield let static implements interface package private protected public await arguments eval undefined NaN ' +
    'Infinity module exports require'
  ).split(' ')
);

// Code for a value the generated code compares with: primitives, and arrays and plain objects of them.
function valueSource(value) {
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return 'NaN';
    }
    if (!Number.isFinite(value)) {
      return value > 0 ? 'Infinity' : '-Infinity';
    }
    return Object.is(value, -0) ? '-0' : String(value);
  }
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${Array.from(value, (item, i) => (i in value ? valueSource(item) : '')).join(', ')}]`;
  }
  if (isPlainObject(value)) {
    // Computed keys, so a "__proto__" key is an own property, as JSON.parse() makes it.
    const entries = Object.entries(value).map(([key, item]) => `[${JSON.stringify(key)}]: ${valueSource(item)}`);
    return `{ ${entries.join(', ')} }`;
  }
  throw new Error(
    `Standalone code cannot contain the value ${String(value)}: only primitives, arrays and plain objects`
  );
}

// Code for a constant of the generated code, adding the names of the helpers it needs to `helpers`.
function constantSource(value, helpers) {
  if (typeof value === 'function') {
    const name = HELPERS.get(value);
    if (name === undefined && value.schivaKeyword !== undefined) {
      throw new Error(
        `Standalone code cannot contain the functions of the keyword "${value.schivaKeyword}": define it as a macro, or compile the schema with compileJsonSchema() instead`
      );
    }
    if (name === undefined) {
      throw new Error(`Standalone code cannot contain the function ${value.name || '(anonymous)'}`);
    }
    const add = (helper) => {
      helpers.add(helper);
      HELPER_SOURCES[helper].calls.forEach(add);
    };
    add(name);
    return name;
  }
  if (value instanceof RegExp) {
    return `new RegExp(${JSON.stringify(value.source)}, ${JSON.stringify(value.flags)})`;
  }
  if (value instanceof Set) {
    return `new Set([${Array.from(value, valueSource).join(', ')}])`;
  }
  return valueSource(value);
}

// An expression giving the validation function of `type`, as compileType(type, options) returns it.
function validatorSource(type, options, helpers) {
  const { mode, source, constants, nodes } = generateSource(toType(type, 'Standalone type'), options);
  if (nodes.length > 0) {
    const names = [...new Set(nodes.map((node) => node.constructor.name))].join(', ');
    throw new Error(
      `Standalone code cannot contain types of your own (${names}): their validate() runs when validating; compile them with compile() instead`
    );
  }
  const code = `const c = [${constants.map((value) => constantSource(value, helpers)).join(', ')}];\n`;
  const factory = `(function () {\n${code}${source}\n})()`;
  if (mode !== 'first') {
    return factory;
  }
  // The first error in a list, as compileType() gives it with allErrors: false.
  return `(function () {
const first = ${factory};
return function validate(value) {
const error = first(value);
return error === undefined ? [] : [error];
};
})()`;
}

// A module with the validators of `entries` ([name, type]): the one without name is the default export.
function moduleSource(entries, options) {
  const format = options.format === undefined ? 'commonjs' : options.format;
  if (format !== 'commonjs' && format !== 'esm') {
    throw new Error(`Unsupported standalone option "format": "${format}" is not "commonjs" or "esm"`);
  }
  const helpers = new Set();
  const validators = entries.map(([name, type]) => {
    if (name !== undefined && (!/^[A-Za-z_$][\w$]*$/.test(name) || RESERVED.has(name) || name === 'c')) {
      throw new Error(`Standalone validator name "${name}" is not a valid JavaScript name`);
    }
    return [name, validatorSource(type, options, helpers)];
  });
  const clash = validators.find(([name]) => helpers.has(name));
  if (clash) {
    throw new Error(`Standalone validator name "${clash[0]}" is the name of a helper of the generated code`);
  }
  let code = `// Generated by schiva ${version}: do not edit, generate it again instead.\n`;
  if (format === 'commonjs') {
    code += "'use strict';\n";
  }
  code += [...helpers].map((helper) => `${HELPER_SOURCES[helper].source}\n`).join('');
  validators.forEach(([name, source]) => {
    code += `const ${name === undefined ? 'validate' : name} = ${source};\n`;
  });
  const names = validators.map(([name]) => name).filter((name) => name !== undefined);
  if (names.length === 0) {
    code +=
      format === 'commonjs'
        ? 'module.exports = validate;\nmodule.exports.default = validate;\n'
        : 'export default validate;\n';
  } else {
    code += format === 'commonjs' ? `module.exports = { ${names.join(', ')} };\n` : `export { ${names.join(', ')} };\n`;
  }
  return code;
}

// Source of a module whose default export (module.exports in CommonJS) is the function compileType(type, options)
// returns. options: those of compile() (allErrors, errors), and format: 'commonjs' (default) or 'esm'.
function standaloneCode(type, options = {}) {
  return moduleSource([[undefined, type]], options);
}

// Source of a module exporting a validation function for each entry of `validators` ({ name: type }), with the
// options of standaloneCode().
function standaloneModule(validators, options = {}) {
  if (!isPlainObject(validators) || Object.keys(validators).length === 0) {
    throw new Error('standaloneModule() expects an object of types by the names to export them with');
  }
  return moduleSource(Object.entries(validators), options);
}

// standaloneCode() for a JSON Schema, with the options of compileJsonSchema() (schemas, draft) too.
function standaloneJsonSchema(json, options = {}) {
  return standaloneCode(fromJsonSchema(json, options), options);
}

module.exports = {
  standaloneCode,
  standaloneModule,
  standaloneJsonSchema,
};
