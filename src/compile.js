const { deepEqual } = require('./deep-equal');
const { Schema } = require('./schema');
const { ClosedSchema } = require('./closed-schema');
const {
  AllOfType,
  AnyOfType,
  AnyType,
  ArrayOfType,
  BooleanType,
  ConditionalType,
  EnumType,
  FloatType,
  IntegerType,
  NeverType,
  NotType,
  ObjType,
  OneOfType,
  RefType,
  StringType,
  ValuesType,
  WhenType,
  hasErrors,
  toErrors,
} = require('./types');
const { NO_TYPE, EVERY_TYPE } = require('./types/one-of');
const { KeywordType } = require('./types/keyword');
const { FORMAT_LIMITS } = require('./types/string');
const { FORMAT_COMPARES } = require('./formats');

// What the built-in comparisons of times put before a value to read its time (see compareTime() in formats.js).
const TIME_PREFIXES = new Map([
  [FORMAT_COMPARES.time, '2020-01-01T'],
  [FORMAT_COMPARES['date-time'], ''],
]);

// How the comparison of a limit of a format fails, as code (see FORMAT_LIMITS in types/string.js).
const FORMAT_LIMIT_FAILS = {
  formatMinimum: '< 0',
  formatMaximum: '> 0',
  formatExclusiveMinimum: '<= 0',
  formatExclusiveMaximum: '>= 0',
};
const { copyDefault } = require('./defaults');
const { CoerceType, coerceSpecOf } = require('./coerce');
const { codePointLength } = require('./types/code-point-length');
const { hasDuplicates } = require('./types/has-duplicates');
const { JSON_TYPES, UnevaluatedType, staticEvaluatedBy, staticEvaluatedByAll } = require('./unevaluated');
const { errorObject, pathName } = require('./error-objects');

// The path of error objects that the code `path` gives when it is the same for every value (keys and positions
// written in the schema, out of loops): an array of keys and indexes, else undefined.
function staticPath(path) {
  if (!path.startsWith('[') || !path.endsWith(']')) {
    return undefined;
  }
  try {
    const value = JSON.parse(path);
    return Array.isArray(value) && value.every((item) => typeof item === 'string' || Number.isInteger(item))
      ? value
      : undefined;
  } catch (e) {
    return undefined;
  }
}

// A literal (key or index) of the code `code`, or undefined when it is worked out when validating.
function literalOf(code) {
  try {
    const value = JSON.parse(code);
    return typeof value === 'string' || Number.isInteger(value) ? value : undefined;
  } catch (e) {
    return undefined;
  }
}

// Compiles a type tree into a single generated function, like ajv does, so validating a value runs inline code
// instead of one isValid()/errors() call per node. There are three modes:
// - check: returns true or false, like isValid().
// - first: returns the first error message or undefined, which is toErrors(type.errors(value))[0].
// - all: returns every error message, which is toErrors(type.errors(value)).
// Messages are built from the same text, in the same order, as the interpreted validate() of each type.
//
// The generated code snapshots the tree: changes made to the types after compiling are not seen.
// Schema keys and message texts are embedded with JSON.stringify, finite numbers as literals; any other value is
// passed in through the `c` array. Types that are not built-in (custom classes and subclasses) run their own
// isValid()/errors().

const MAX_INLINE_KEYS = 8;

// A check this long (in characters of generated code) goes into its own function instead of being inlined.
const MAX_INLINE_CODE = 4000;

// Checks for a value that is neither undefined nor null, like isJsonType().
const JSON_TYPE_CHECKS = {
  object: (v) => `typeof ${v} === 'object' && !Array.isArray(${v})`,
  array: (v) => `Array.isArray(${v})`,
  string: (v) => `typeof ${v} === 'string'`,
  number: (v) => `typeof ${v} === 'number'`,
};

// Code testing the JSON types a keyword of your own can be limited to, for a value neither undefined nor null.
const KEYWORD_TYPE_CHECKS = {
  string: (v) => `typeof ${v} === 'string'`,
  number: (v) => `typeof ${v} === 'number'`,
  integer: (v) => `Number.isInteger(${v})`,
  boolean: (v) => `typeof ${v} === 'boolean'`,
  object: (v) => `(typeof ${v} === 'object' && !Array.isArray(${v}))`,
  array: (v) => `Array.isArray(${v})`,
  null: () => 'false',
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Code of the tests of coerce.js TYPE_TESTS, for the value in `x`.
const COERCE_TYPE_TESTS = {
  string: (x) => `typeof ${x} === 'string'`,
  number: (x) => `(typeof ${x} === 'number' && Number.isFinite(${x}))`,
  integer: (x) => `Number.isInteger(${x})`,
  boolean: (x) => `typeof ${x} === 'boolean'`,
  null: (x) => `${x} === null`,
  object: (x) => `(${x} !== null && typeof ${x} === 'object' && !Array.isArray(${x}))`,
  array: (x) => `Array.isArray(${x})`,
};

// Code of the conversions of coerce.js COERCIONS: [condition, value] pairs, for the value in `x` whose typeof is in `t`.
const COERCE_CODE = {
  string: (x, t) => [
    [`${t} === 'number' || ${t} === 'boolean'`, `"" + ${x}`],
    [`${x} === null`, '""'],
  ],
  number: (x, t) => [
    [`${t} === 'boolean' || ${x} === null || (${t} === 'string' && ${x} !== "" && !Number.isNaN(+${x}))`, `+${x}`],
  ],
  integer: (x, t) => [
    [
      `${t} === 'boolean' || ${x} === null || (${t} === 'string' && ${x} !== "" && !Number.isNaN(+${x}) && +${x} % 1 === 0)`,
      `+${x}`,
    ],
  ],
  boolean: (x) => [
    [`${x} === "false" || ${x} === 0 || ${x} === null`, 'false'],
    [`${x} === "true" || ${x} === 1`, 'true'],
  ],
  null: (x) => [[`${x} === "" || ${x} === 0 || ${x} === false`, 'null']],
  array: (x, t) => [[`${t} === 'string' || ${t} === 'number' || ${t} === 'boolean' || ${x} === null`, `[${x}]`]],
};

// Condition on the value in `x` (code) that its default ({ empty }, see assignDefaults()) replaces.
const missingCode = (x, { empty }) =>
  empty ? `${x} === undefined || ${x} === null || ${x} === ""` : `${x} === undefined`;

// Code creating a new copy of a JSON value (arrays, plain objects and primitives), as a default is assigned; undefined
// for other values. Keys are computed, so a "__proto__" key is a plain entry.
function literalCode(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `(${JSON.stringify(value)})` : undefined;
  }
  if (Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype) {
    const items = value.map(literalCode);
    return items.every((item) => item !== undefined) ? `[${items.join(', ')}]` : undefined;
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.keys(value).map((key) => [key, literalCode(value[key])]);
    return entries.every(([, item]) => item !== undefined)
      ? `{ ${entries.map(([key, item]) => `[${JSON.stringify(key)}]: ${item}`).join(', ')} }`
      : undefined;
  }
  return undefined;
}

function ownerOf(obj, name) {
  let proto = obj;
  while (proto && !hasOwn(proto, name)) {
    proto = Object.getPrototypeOf(proto);
  }
  return proto;
}

// A subclass that overrides validate() but inherits isValid() must be checked through validate().
function checksThroughValidate(type) {
  const validateOwner = ownerOf(type, 'validate');
  const isValidOwner = ownerOf(type, 'isValid');
  return validateOwner !== isValidOwner && Object.prototype.isPrototypeOf.call(isValidOwner, validateOwner);
}

// A `path` is a JS expression giving the fieldName passed to validate(): 'undefined' at the root, 'p' in the function
// of a reference target (where it can be undefined), and otherwise an expression that gives a string. Paths are only
// evaluated to build messages.

// Name of a node in its messages, as validate() defaults fieldName to 'Value'.
function valuePath(path) {
  if (path === 'undefined') {
    return '"Value"';
  }
  return path === 'p' ? '(p === undefined ? "Value" : p)' : path;
}

// Name of a Schema in its messages, as Schema uses fieldName || 'Value'.
function schemaName(path) {
  return path === 'undefined' ? '"Value"' : `(${path} || "Value")`;
}

// Name of a Schema key, as Schema uses fieldName ? `${fieldName}.${key}` : key. `key` is a JS expression.
function keyPath(path, key) {
  return path === 'undefined' ? key : `J(${path}, ${key})`;
}

// Same text as ValuesType.validate().
function formatValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function valuesMessage(values) {
  if (values.length === 1) {
    return ` must be equal to ${formatValue(values[0])}`;
  }
  return ` must be one of: ${values.map(formatValue).join(', ')}`;
}

const OBJECT_METHODS = ['constructor', 'valueOf', 'toString'];

// Values made of plain objects, arrays and primitives, for which deepEqual() can be written out as code.
function isPlainValue(value) {
  if (value === null || typeof value !== 'object') {
    return typeof value !== 'bigint' && typeof value !== 'symbol' && typeof value !== 'function';
  }
  if (Array.isArray(value)) {
    return (
      Object.getPrototypeOf(value) === Array.prototype &&
      Object.keys(value).length === value.length &&
      value.every(isPlainValue)
    );
  }
  return (
    Object.getPrototypeOf(value) === Object.prototype &&
    !OBJECT_METHODS.some((key) => hasOwn(value, key)) &&
    Object.values(value).every(isPlainValue)
  );
}

// Expression for deepEqual(value, x), where `value` is a plain value, following the same steps: identity or NaN for
// primitives; for objects the same constructor, then the same length and elements (arrays) or the same key count
// and own keys (objects).
function equalsCode(value, x) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && Number.isNaN(value)) {
      return `(typeof ${x} === 'number' && ${x} !== ${x})`;
    }
    if (typeof value === 'number') {
      return `${x} === ${Number.isFinite(value) ? `(${value})` : `${value > 0 ? '' : '-'}Infinity`}`;
    }
    return `${x} === ${value === undefined ? 'undefined' : JSON.stringify(value)}`;
  }
  const isObject = `typeof ${x} === 'object' && ${x} !== null`;
  if (Array.isArray(value)) {
    const items = value.map((item, i) => equalsCode(item, `${x}[${i}]`));
    return `(${[isObject, `${x}.constructor === Array`, `${x}.length === ${value.length}`, ...items].join(' && ')})`;
  }
  const keys = Object.keys(value);
  const entries = keys.map((key) => {
    const literal = JSON.stringify(key);
    return `H.call(${x}, ${literal}) && ${equalsCode(value[key], `${x}[${literal}]`)}`;
  });
  return `(${[isObject, `${x}.constructor === Object`, `Object.keys(${x}).length === ${keys.length}`, ...entries].join(
    ' && '
  )})`;
}

// Helpers for types that are not built-in, which run their own errors().
function firstError(type, value, fieldName) {
  return toErrors(type.errors(value, fieldName))[0];
}

// The list of errors of generated code, undefined until the first error, with the errors of a type added.
function pushErrors(out, type, value, fieldName) {
  const errors = toErrors(type.errors(value, fieldName));
  if (errors.length === 0) {
    return out;
  }
  return out === undefined ? errors : out.concat(errors);
}

// The same for errors as objects: a type of your own gives messages, which become errors with the keyword "custom"
// at the path of its value (named as fieldName, undefined for the value itself).
function customErrors(type, value, path) {
  const params = { type: type.constructor.name };
  return toErrors(type.errors(value, path.length > 0 ? pathName(path) : undefined)).map((message) =>
    errorObject(path, 'custom', params, message)
  );
}

function firstErrorObject(type, value, path) {
  return customErrors(type, value, path)[0];
}

function pushErrorObjects(out, type, value, path) {
  const errors = customErrors(type, value, path);
  if (errors.length === 0) {
    return out;
  }
  return out === undefined ? errors : out.concat(errors);
}

// A message for Generator.emit(): `text` gives the code of its text; `path` is the code of the path of the value it is
// about, `keyword` the name of the check and `params` the code of an object with its details.
function messageAt(path, text, keyword, params = '{}') {
  return Object.assign(text, { path, keyword, params });
}

class Generator {
  // `structured`: errors as objects (see error-objects.js), with the paths of the values as arrays of keys and
  // indexes instead of their names.
  constructor(mode, structured = false) {
    this.mode = mode;
    this.structured = structured;
    this.constants = [];
    this.nodes = [];
    this.functions = [];
    this.checkFunctions = new Map();
    // Functions adding what a type evaluates to a Set, by kind ('properties' or 'items'): see evaluatedFunction().
    this.evaluatedFunctions = { properties: new Map(), items: new Map() };
    // Per mode, the function validating each reference target.
    this.refFunctions = { check: new Map(), first: new Map(), all: new Map() };
    this.count = 0;
    // Nodes being generated, to fall back to their own isValid()/errors() if a tree refers to itself.
    this.visiting = new Set();
    // Statement for a failed check in 'check' mode: a return, or a break out of an inlined check.
    this.fail = 'return false;';
    // Generated function being written: code shares variables only within one (see sharedMatches).
    this.scope = 0;
    this.scopes = 0;
    // OneOf nodes of an allOf whose matching alternatives a later "unevaluated*" of the same allOf reuses: the
    // variables they are recorded in, the value and function they belong to, and whether the oneOf wrote them.
    this.sharedMatches = new Map();
    // Each oneOf with a discriminator to the same alternatives without it, which other values are checked against.
    this.plainOneOfs = new Map();
    // Values ("scope:variable") whose `plain` flag an enclosing allOf declares (see allOf()).
    this.plainDeclared = new Set();
    // In 'all' mode, whether the same error can be reported twice (several parts of an allOf, alternatives, or
    // patterns checking a key): the result then keeps each error once.
    this.mayRepeat = false;
  }

  // Runs `generate` as the body of another generated function.
  inScope(generate) {
    const { scope } = this;
    this.scopes += 1;
    this.scope = this.scopes;
    const result = generate();
    this.scope = scope;
    return result;
  }

  name(prefix) {
    this.count += 1;
    return `${prefix}${this.count}`;
  }

  constant(value) {
    this.constants.push(value);
    return `c[${this.constants.length - 1}]`;
  }

  number(value) {
    return typeof value === 'number' && Number.isFinite(value) ? `(${value})` : this.constant(value);
  }

  node(type) {
    let index = this.nodes.indexOf(type);
    if (index === -1) {
      this.nodes.push(type);
      index = this.nodes.length - 1;
    }
    return `n[${index}]`;
  }

  // Statement for a failed check; `message` gives the message expression and is only called when needed.
  // The error of a failed check: `message` gives the code of its text, and says the path of the value, the keyword
  // and the code of its params (see messageAt()). Errors are texts, or objects when structured.
  emit(message) {
    if (this.mode === 'check') {
      return this.fail;
    }
    let text = message();
    let { path } = message;
    // A path known when compiling: the error object is written out, pointer included, like errorObject() builds it.
    const known = this.structured ? staticPath(path) : undefined;
    if (known) {
      const pointer = known.map((key) => `/${`${key}`.replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
      const object = `{ path: ${path}, pointer: ${JSON.stringify(pointer)}, keyword: ${JSON.stringify(message.keyword)}, params: ${message.params}, message: ${text} }`;
      return this.mode === 'first' ? `return ${object};` : `out = P(out, ${object});`;
    }
    let assign = '';
    // A path that is built (not the variable of a function, or []) is built once, in variable q, for the object and
    // its message.
    if (this.structured && path.length > 3) {
      text = text.split(path).join('q');
      assign = `q = ${path}, `;
      path = 'q';
    }
    const error = this.structured
      ? `(${assign}${this.constant(errorObject)}(${path}, ${JSON.stringify(message.keyword)}, ${message.params}, ${text}))`
      : text;
    // The list of errors is only made with the first one: valid values build none.
    return this.mode === 'first' ? `return ${error};` : `out = P(out, ${error});`;
  }

  // Code of the path of the value itself: undefined (no name), or an empty array when structured.
  rootPath() {
    return this.structured ? '[]' : 'undefined';
  }

  // Code of the name of the value at `path`, as messages start with it; a Schema is "Value" at the root.
  nameOf(path, isSchema) {
    if (!this.structured) {
      return isSchema ? schemaName(path) : valuePath(path);
    }
    // A path known when compiling has its name written out.
    const known = staticPath(path);
    if (known) {
      return JSON.stringify(pathName(known));
    }
    const name = `${this.constant(pathName)}(${path})`;
    return isSchema ? `(${name} || "Value")` : name;
  }

  // Code of the path of the key `key` (code) of the object at `path`.
  keyOf(path, key) {
    if (!this.structured) {
      return keyPath(path, key);
    }
    const known = staticPath(path);
    if (known && literalOf(key) !== undefined) {
      return JSON.stringify([...known, literalOf(key)]);
    }
    return path === '[]' ? `[${key}]` : `${path}.concat([${key}])`;
  }

  // Code of the path of the element `index` (code) of the array at `path`, whose name is `name`.
  indexOf(path, name, index) {
    if (!this.structured) {
      return `(${name} + "[" + ${index} + "]")`;
    }
    const known = staticPath(path);
    if (known && literalOf(String(index)) !== undefined) {
      return JSON.stringify([...known, literalOf(String(index))]);
    }
    return path === '[]' ? `[${index}]` : `${path}.concat([${index}])`;
  }

  // Code of the path of a key checked by propertyNames, as a value: its name is "Key <name>".
  propertyNameOf(path, key) {
    if (!this.structured) {
      return `("Key " + ${keyPath(path, key)})`;
    }
    return path === '[]' ? `[{ key: ${key} }]` : `${path}.concat([{ key: ${key} }])`;
  }

  // Checks [condition, message, pre] run in order until one fails; `rest` runs when none fails. The optional `pre`
  // statements run just before their condition, only when the previous checks passed.
  chain(checks, rest = '') {
    let code = '';
    for (let i = 0; i < checks.length; i += 1) {
      const [condition, message, pre] = checks[i];
      if (pre) {
        const remaining = this.chain([[condition, message], ...checks.slice(i + 1)], rest);
        return `${code}${i ? 'else ' : ''}{\n${pre}${remaining}}\n`;
      }
      code += `${i ? 'else ' : ''}if (${condition}) { ${this.emit(message)} }\n`;
    }
    if (!rest) {
      return code;
    }
    return checks.length ? `${code}else {\n${rest}}\n` : rest;
  }

  // Generates a separate function in 'check' mode, where a failure returns false.
  inFunction(generate) {
    const { mode, fail, visiting } = this;
    this.mode = 'check';
    this.fail = 'return false;';
    this.visiting = new Set();
    const body = this.inScope(generate);
    this.mode = mode;
    this.fail = fail;
    this.visiting = visiting;
    return body;
  }

  // Name of a boolean function checking `type`, shared by every use of the same node.
  checkFunction(type) {
    if (!this.checkFunctions.has(type)) {
      const name = this.name('check');
      this.checkFunctions.set(type, name);
      const body = this.inFunction(() => this.generate(type, 'x', 'undefined'));
      this.functions.push(`function ${name}(x) {\n${body}return true;\n}\n`);
    }
    return this.checkFunctions.get(type);
  }

  // Code that runs `onPass` when the value in `v` satisfies `type`. The check is inlined in a labelled block that a
  // failure breaks out of, which avoids a function call; a long one goes into a function instead.
  inlineCheck(type, v, onPass) {
    const { mode, fail } = this;
    const label = this.name('L');
    this.mode = 'check';
    this.fail = `break ${label};`;
    const written = [...this.sharedMatches.values()].map((shared) => [shared, shared.written]);
    const body = this.generate(type, v, 'undefined');
    this.mode = mode;
    this.fail = fail;
    if (body.length > MAX_INLINE_CODE) {
      // The inlined code is dropped, with the variables it would have written.
      written.forEach(([shared, wasWritten]) => {
        shared.written = wasWritten;
      });
      return `if (${this.checkFunction(type)}(${v})) { ${onPass} }\n`;
    }
    return `${label}: {\n${body}${onPass}\n}\n`;
  }

  // Name of the function validating a reference target in the current mode. It takes the value and, to build
  // messages, the field name (and the error list in 'all' mode), so recursive schemas call it again.
  refFunction(target) {
    const functions = this.refFunctions[this.mode];
    if (!functions.has(target)) {
      const name = this.name(`ref_${this.mode}`);
      functions.set(target, name);
      const params = { check: 'x', first: 'x, p', all: 'x, p, out' }[this.mode];
      const end = {
        check: 'return true;',
        first: 'return undefined;',
        all: 'return out;',
      }[this.mode];
      // The target may be an outer node being generated: its function is generated on its own.
      const { visiting, fail } = this;
      this.visiting = new Set();
      this.fail = 'return false;';
      let body = this.inScope(() => this.generate(target, 'x', this.mode === 'check' ? 'undefined' : 'p'));
      // The variable of the paths of error objects (see emit()).
      if (this.structured && this.mode !== 'check') {
        body = `let q;\n${body}`;
      }
      this.visiting = visiting;
      this.fail = fail;
      this.functions.push(`function ${name}(${params}) {\n${body}${end}\n}\n`);
    }
    return functions.get(target);
  }

  // Like RefType: undefined is checked here, any other value by the target.
  ref(type, v, path) {
    const onUndefined = type.isMandatory
      ? this.emit(messageAt(path, () => `${this.nameOf(path, false)} + " is mandatory"`, 'required'))
      : '';
    const target = type.getTarget();
    const fn = this.refFunction(target);
    let call = `if (!${fn}(${v})) { ${this.fail} }\n`;
    if (this.mode === 'first') {
      const e = this.name('e');
      call = `const ${e} = ${fn}(${v}, ${path});\nif (${e} !== undefined) { return ${e}; }\n`;
    } else if (this.mode === 'all') {
      call = `out = ${fn}(${v}, ${path}, out);\n`;
    }
    // Building messages, a field name that has to be built (a key or an index) is built only for an invalid value,
    // which the boolean function of the target finds first. Valid elements of an array then build no strings.
    if (this.mode !== 'check' && !/^(undefined|p|\[\]|"[^"\\]*")$/.test(path)) {
      const { mode } = this;
      this.mode = 'check';
      const check = this.refFunction(target);
      this.mode = mode;
      call = `if (!${check}(${v})) {\n${call}}\n`;
    }
    return `if (${v} === undefined) { ${onUndefined} } else {\n${call}}\n`;
  }

  // Code validating the value held in variable `v` against `type`, with `path` giving its field name. When `known`
  // names a JSON type, the value is known to be of that type (so neither undefined nor null): presence and that type
  // are not checked again. Types that accept every value give no code.
  generate(type, v, path, known = undefined) {
    if (type.constructor === RefType) {
      return this.ref(type, v, path);
    }
    if (type.constructor === CoerceType) {
      // The value validated, converted for the validation only (it is in no object or array).
      return this.coerceCode(type.spec, v) + this.generate(type.type, v, path, known);
    }
    if (this.visiting.has(type)) {
      return this.custom(type, v, path);
    }
    this.visiting.add(type);
    const isSchema = type.constructor === Schema || type.constructor === ClosedSchema;
    const name = this.nameOf(path, isSchema);
    const body = this.body(type, v, path, name, known);
    this.visiting.delete(type);
    if (body === undefined) {
      return this.custom(type, v, path);
    }
    const checks = this.chain(body.checks, body.rest);
    if (known) {
      return checks;
    }
    const text = (suffix, keyword) => messageAt(path, () => `${name} + ${JSON.stringify(suffix)}`, keyword);
    const onUndefined = type.isMandatory ? this.emit(text(' is mandatory', 'required')) : '';
    const onNull = type.isNullable ? '' : this.emit(text(' cannot be null', 'nullable'));
    if (!onUndefined && !onNull) {
      return checks ? `if (${v} !== undefined && ${v} !== null) {\n${checks}}\n` : '';
    }
    return `if (${v} === undefined) { ${onUndefined} } else if (${v} === null) { ${onNull} } else {\n${checks}}\n`;
  }

  custom(type, v, path) {
    const node = this.node(type);
    const invalid = checksThroughValidate(type)
      ? `${this.constant(hasErrors)}(${node}.validate(${v}))`
      : `!${node}.isValid(${v})`;
    let onInvalid = this.fail;
    if (this.mode === 'first') {
      onInvalid = `return r(${node}, ${v}, ${path});`;
    } else if (this.mode === 'all') {
      onInvalid = `out = a(out, ${node}, ${v}, ${path});`;
    }
    return `if (${invalid}) { ${onInvalid} }\n`;
  }

  // Checks for a value that is neither undefined nor null, as { checks, rest }; undefined when the type is not a
  // built-in one.
  body(type, v, path, name, known) {
    // A message about this value: its text is its name and `suffix`; `keyword` names the check and `params` is the code
    // of an object with its details (see messageAt()).
    const text = (suffix, keyword, params) =>
      messageAt(path, () => `${name} + ${JSON.stringify(suffix)}`, keyword, params);
    switch (type.constructor) {
      case Schema:
      case ClosedSchema:
        return this.schema(type, v, path, name, text, known);
      case ObjType:
        return {
          checks: [
            [
              `typeof ${v} !== 'object' || Array.isArray(${v})`,
              text(' must be an object', 'type', "{ type: 'object' }"),
            ],
          ],
          rest: type.schema ? this.generate(type.schema, v, path) : '',
        };
      case ArrayOfType:
        return this.arrayOf(type, v, path, name, text, known);
      case UnevaluatedType:
        return this.unevaluated(type, v, path, name);
      case AllOfType:
        return { checks: [], rest: this.allOf(type, v, path, known) };
      case ConditionalType: {
        // Without branches it accepts every value (it is kept for what "if" evaluates, see unevaluated.js).
        if (!type.thenType && !type.elseType) {
          return { checks: [], rest: '' };
        }
        // Only the chosen branch is checked and reported, like ConditionalType.validate().
        const branch = (branchType) => (branchType ? this.generate(branchType, v, path) : '');
        const ok = this.name('ok');
        const rest = `let ${ok} = false;\n${this.inlineCheck(type.ifType, v, `${ok} = true;`)}if (${ok}) {\n${branch(
          type.thenType
        )}} else {\n${branch(type.elseType)}}\n`;
        return { checks: [], rest };
      }
      case AnyOfType:
        return { checks: [], rest: this.anyOf(type, v, path) };
      case OneOfType:
        return this.oneOf(type, v, path, text);
      case KeywordType:
        return { checks: [this.keyword(type, v, path, name)] };
      case NotType: {
        const ok = this.name('ok');
        const pre = `let ${ok} = false;\n${this.inlineCheck(type.type, v, `${ok} = true;`)}`;
        return {
          checks: [[ok, text(' must not match the excluded schema', 'not'), pre]],
        };
      }
      case StringType:
        return { checks: this.string(type, v, text, known) };
      case EnumType:
        return {
          checks: [
            ...this.string(type, v, text, known),
            [
              `!${this.constant(new Set(type.options))}.has(${v})`,
              text(
                ` must be one of: ${type.options.join(', ')}`,
                'enum',
                `{ allowedValues: ${JSON.stringify(type.options)} }`
              ),
            ],
          ],
        };
      case FloatType:
        return { checks: this.float(type, v, text) };
      case IntegerType:
        return {
          checks: [
            ...this.float(type, v, text),
            [`!Number.isInteger(${v})`, text(' must be an integer', 'type', "{ type: 'integer' }")],
          ],
        };
      case BooleanType:
        return {
          checks: [[`typeof ${v} !== 'boolean'`, text(' must be a boolean', 'type', "{ type: 'boolean' }")]],
        };
      case AnyType:
        return { checks: [] };
      case NeverType:
        return { checks: [['true', text(' is not allowed', 'false')]] };
      case ValuesType:
        return {
          checks: [
            [this.notOneOf(type.values, v), text(valuesMessage(type.values), ...this.valuesKeyword(type.values))],
          ],
        };
      case WhenType:
        // The field name goes through unchanged, like WhenType.validate(). A value known to be of its JSON type
        // needs no check.
        if (known === type.jsonType) {
          return { checks: [], rest: this.generate(type.type, v, path, known) };
        }
        return {
          checks: [],
          rest: `if (${JSON_TYPE_CHECKS[type.jsonType](v)}) {\n${this.generate(type.type, v, path, type.jsonType)}}\n`,
        };
      default:
        return undefined;
    }
  }

  string(type, v, text, known) {
    const checks =
      known === 'string' ? [] : [[`typeof ${v} !== 'string'`, text(' must be a string', 'type', "{ type: 'string' }")]];
    // Code points are only counted near the limit, like hasFewerCodePoints() and hasMoreCodePoints().
    const count = () => `${this.constant(codePointLength)}(${v})`;
    if (type.min !== undefined) {
      const allowEmpty = type.allowEmpty ?? !type.isMandatory;
      const min = this.number(type.min);
      const tooShort = type.countCodePoints
        ? `(${v}.length < ${min} || (${v}.length < 2 * ${min} && ${count()} < ${min}))`
        : `${v}.length < ${min}`;
      checks.push([
        allowEmpty ? `${tooShort} && ${v}.length !== 0` : tooShort,
        text(` must be at least ${type.min} characters long`, 'minLength', `{ limit: ${this.number(type.min)} }`),
      ]);
    }
    if (type.max !== undefined) {
      const max = this.number(type.max);
      const tooLong = type.countCodePoints
        ? `(${v}.length > 2 * ${max} || (${v}.length > ${max} && ${count()} > ${max}))`
        : `${v}.length > ${max}`;
      checks.push([
        tooLong,
        text(` must be at most ${type.max} characters long`, 'maxLength', `{ limit: ${this.number(type.max)} }`),
      ]);
    }
    if (type.pattern) {
      checks.push([
        `!${this.constant(type.pattern)}.test(${v})`,
        text(' does not match the required pattern', 'pattern', `{ pattern: ${JSON.stringify(type.pattern.source)} }`),
      ]);
    }
    if (type.formatCheck !== undefined) {
      const check = this.constant(type.formatCheck);
      const matches = type.formatCheck instanceof RegExp ? `${check}.test(${v})` : `${check}(${v})`;
      checks.push([
        `!${matches}`,
        text(` must be a valid ${type.format}`, 'format', `{ format: ${JSON.stringify(type.format)} }`),
      ]);
    }
    // Limits of the format, like StringType.failedLimit(): compare() gives a number, or undefined, which passes. The
    // built-in comparisons are written out, with the limit worked out once (see compareDate() and the others in
    // formats.js): dates compare as strings (the value has the format, so it is not empty), times and date-times by
    // their time in ms, read once for every limit; a time of 0 or NaN compares as undefined.
    let ms;
    type.formatLimits.forEach(({ keyword, limit, compare }) => {
      const { text: words, comparison } = FORMAT_LIMITS[keyword];
      const literal = JSON.stringify(limit);
      const message = text(` must be ${words} ${limit}`, keyword, `{ comparison: "${comparison}", limit: ${literal} }`);
      const operator = FORMAT_LIMIT_FAILS[keyword].slice(0, -2);
      if (compare === FORMAT_COMPARES.date) {
        checks.push([`${v} ${operator} ${literal}`, message]);
      } else if (TIME_PREFIXES.has(compare)) {
        const prefix = TIME_PREFIXES.get(compare);
        const limitMs = new Date(`${prefix}${limit}`).valueOf();
        // A limit whose time is 0 compares as undefined: it never fails.
        if (limitMs) {
          let pre;
          if (!ms) {
            ms = this.name('ms');
            pre = `const ${ms} = new Date(${prefix ? `"${prefix}" + ` : ''}${v}).valueOf();\n`;
          }
          checks.push([`${ms} && ${ms} ${operator} ${limitMs}`, message, pre]);
        }
      } else {
        checks.push([`${this.constant(compare)}(${v}, ${literal}) ${FORMAT_LIMIT_FAILS[keyword]}`, message]);
      }
    });
    return checks;
  }

  float(type, v, text) {
    const limits = [
      [type.min, '<', 'must be at least', 'minimum'],
      [type.max, '>', 'must be at most', 'maximum'],
      [type.exclusiveMin, '<=', 'must be greater than', 'exclusiveMinimum'],
      [type.exclusiveMax, '>=', 'must be less than', 'exclusiveMaximum'],
    ];
    const checks = [
      [`!Number.isFinite(${v})`, text(' must be a number', 'type', "{ type: 'number' }")],
      ...limits
        .filter(([limit]) => limit !== undefined)
        .map(([limit, operator, message, keyword]) => [
          `${v} ${operator} ${this.number(limit)}`,
          text(` ${message} ${limit}`, keyword, `{ limit: ${this.number(limit)} }`),
        ]),
    ];
    if (type.multipleOf !== undefined) {
      const division = `${v} / ${this.number(type.multipleOf)}`;
      // Like FloatType.isMultiple().
      const notMultiple =
        type.multipleOfPrecision === undefined
          ? `!Number.isInteger(${division})`
          : `Math.abs(Math.round(${division}) - ${division}) > 1e-${type.multipleOfPrecision}`;
      checks.push([
        notMultiple,
        text(
          ` must be a multiple of ${type.multipleOf}`,
          'multipleOf',
          `{ multipleOf: ${this.number(type.multipleOf)} }`
        ),
      ]);
    }
    return checks;
  }

  // Like ValuesType: `v` (neither undefined nor null) is deep-equal to none of the values. Plain values are compared
  // with code written for them; others with deepEqual(), only for objects as it is false for anything else.
  // Keyword and params of the message of a ValuesType: const for one value, enum for several.
  valuesKeyword(values) {
    if (values.length === 1) {
      return ['const', this.structured ? `{ allowedValue: ${this.constant(values[0])} }` : '{}'];
    }
    return ['enum', this.structured ? `{ allowedValues: ${this.constant(values)} }` : '{}'];
  }

  notOneOf(values, v) {
    const matches = [];
    values.forEach((value) => {
      if (value === undefined || value === null) {
        // Never equal to a value that is neither undefined nor null.
      } else if (isPlainValue(value)) {
        matches.push(equalsCode(value, v));
      } else if (typeof value === 'object') {
        matches.push(`(typeof ${v} === 'object' && ${this.constant(deepEqual)}(${this.constant(value)}, ${v}))`);
      } else {
        matches.push(`${v} === ${this.constant(value)}`);
      }
    });
    return matches.length ? `!(${matches.join(' || ')})` : 'true';
  }

  // The parts run in order; in 'all' mode each one adds its errors, like AllOfType.validate(). They get the field
  // name of the allOf as it is (`path`), so a Schema part names its keys as it does on its own.
  allOf(type, v, path, known = undefined) {
    this.mayRepeat = this.mayRepeat || type.types.length > 1;
    const shared = this.shareMatches(type, v);
    let code = shared.map(({ vars }) => `let ${vars.join(' = false, ')} = false;\n`).join('');
    // Whether the value is a plain object is worked out once for all the parts (see schema()): reading __proto__ is
    // slow on objects of many shapes. The value is neither undefined nor null here.
    const plain = `${this.scope}:${v}`;
    const declares = !this.plainDeclared.has(plain);
    this.plainDeclared.add(plain);
    const parts = type.types.map((item) => this.generate(item, v, path, known)).join('');
    if (declares) {
      this.plainDeclared.delete(plain);
      if (new RegExp(`\\b${v}plain\\b`).test(parts)) {
        code += `const ${v}plain = ${v}.__proto__ === OP;\n`;
      }
    }
    code += parts;
    shared.forEach(({ oneOf, previous }) => {
      if (previous === undefined) {
        this.sharedMatches.delete(oneOf);
      } else {
        this.sharedMatches.set(oneOf, previous);
      }
    });
    return code;
  }

  // The oneOf parts of an allOf whose matching alternatives an "unevaluated*" part of the same allOf needs: oneOf()
  // records them in variables that the allOf declares, and evaluatedCondition() reads them instead of checking the
  // alternatives again. They belong to the value in `v` and to the function being written.
  shareMatches(type, v) {
    const oneOfs = new Set();
    type.types
      .filter((item) => item.constructor === UnevaluatedType)
      .forEach((unevaluated) =>
        unevaluated.siblings
          .filter((sibling) => sibling.constructor === OneOfType && type.types.includes(sibling))
          .filter((sibling) => staticEvaluatedBy(unevaluated.kind, sibling) === undefined)
          .forEach((sibling) => oneOfs.add(sibling))
      );
    return [...oneOfs].map((oneOf) => {
      const previous = this.sharedMatches.get(oneOf);
      const vars = oneOf.types.map(() => this.name('matched'));
      this.sharedMatches.set(oneOf, {
        vars,
        v,
        scope: this.scope,
        written: false,
      });
      return { oneOf, previous, vars };
    });
  }

  // The variables holding which alternatives of `oneOf` match the value in `v`, when oneOf() wrote them in the
  // function being written; undefined otherwise.
  matchesOf(oneOf, v) {
    const shared = this.sharedMatches.get(oneOf);
    return shared && shared.written && shared.v === v && shared.scope === this.scope ? shared.vars : undefined;
  }

  // Code for a value that no alternative accepts: the errors of every alternative, like AnyOfType.validate().
  noneMatches(types, v, path) {
    if (this.mode === 'check') {
      return this.fail;
    }
    if (this.mode === 'first') {
      return this.generate(types[0], v, path);
    }
    this.mayRepeat = this.mayRepeat || types.length > 1;
    return types.map((item) => this.generate(item, v, path)).join('');
  }

  // The alternatives get the field name as it is, like the parts of an allOf.
  anyOf(type, v, path) {
    if (!type.types || type.types.length === 0) {
      return '';
    }
    const ok = this.name('ok');
    let code = `let ${ok} = false;\n`;
    type.types.forEach((item, i) => {
      const check = this.inlineCheck(item, v, `${ok} = true;`);
      code += i ? `if (!${ok}) {\n${check}}\n` : check;
    });
    return `${code}if (!${ok}) {\n${this.noneMatches(type.types, v, path)}}\n`;
  }

  // Counts up to two matching alternatives, like OneOfType.countMatches().
  oneOf(type, v, path, text) {
    if (type.types.length === 0) {
      return {
        checks: [['true', text(' must match exactly one schema, but matches none', 'oneOf', '{ passing: 0 }')]],
      };
    }
    // An "unevaluated*" of the same allOf may reuse which alternatives match (see shareMatches()). When the oneOf
    // passes, every alternative has been checked.
    const shared = this.sharedMatches.get(type);
    const record = shared && shared.v === v && shared.scope === this.scope ? shared : undefined;
    // With a discriminator, objects are only checked against the alternative their tag picks. Other values are
    // checked here when the matches are recorded, else in a function of their own.
    if (type.discriminator) {
      const others = record ? this.countedOneOf(type, v, path, text, record) : undefined;
      return { checks: [], rest: this.discriminated(type, v, path, record, others) };
    }
    return { checks: [], rest: this.countedOneOf(type, v, path, text, record) };
  }

  // Code counting the alternatives the value matches, up to two, recording them in `record` when given.
  countedOneOf(type, v, path, text, record) {
    const m = this.name('m');
    let rest = `let ${m} = 0;\n`;
    type.types.forEach((item, i) => {
      const onPass = record ? `${m} += 1; ${record.vars[i]} = true;` : `${m} += 1;`;
      const check = this.inlineCheck(item, v, onPass);
      rest += i > 1 ? `if (${m} < 2) {\n${check}}\n` : check;
    });
    if (record) {
      record.written = true;
    }
    const more = this.emit(
      text(' must match exactly one schema, but matches more than one', 'oneOf', '{ passing: 2 }')
    );
    if (this.mode === 'check') {
      rest += `if (${m} !== 1) { ${this.fail} }\n`;
    } else {
      rest += `if (${m} === 0) {\n${this.noneMatches(type.types, v, path)}} else if (${m} > 1) { ${more} }\n`;
    }
    return rest;
  }

  // Code calling the function that validates `type` in the current mode (see refFunction()), for the value in `v`.
  callFunction(type, v, path) {
    const fn = this.refFunction(type);
    if (this.mode === 'first') {
      const e = this.name('e');
      return `const ${e} = ${fn}(${v}, ${path});\nif (${e} !== undefined) { return ${e}; }\n`;
    }
    return this.mode === 'all' ? `out = ${fn}(${v}, ${path}, out);\n` : `if (!${fn}(${v})) { ${this.fail} }\n`;
  }

  // Code setting variable `d` to what the discriminator of `type` picks for the value in `x`, like OneOfType.pick().
  pickCode(type, x, d) {
    const { tag, mapping, auto } = type.discriminator;
    const t = this.name('t');
    const literal = JSON.stringify(tag);
    const values = [...mapping.keys()];
    const chain = values.map((value) => `${t} === ${JSON.stringify(value)} ? ${mapping.get(value)} : `).join('');
    return (
      `let ${d} = ${EVERY_TYPE};\n` +
      `if (typeof ${x} === 'object' && ${x} !== null && !Array.isArray(${x})) {\n` +
      `const ${t} = H.call(${x}, ${literal}) ? ${x}[${literal}] : undefined;\n` +
      `${d} = ${chain}${auto ? EVERY_TYPE : NO_TYPE};\n}\n`
    );
  }

  // Like OneOfType.validate() with a discriminator: an object is checked against the alternative the value of its tag
  // (an own property) picks. An object whose tag picks none gets an error about the tag at its path, or with a
  // discriminator found in a plain oneOf (`auto`) is checked as by oneOf, like other values. Those go to a function
  // of their own (they are rare, and the validator stays small).
  // With `record`, the alternative that matches is recorded there, and `others` checks the other values.
  discriminated(type, v, path, record = undefined, others = undefined) {
    const { tag, mapping, auto } = type.discriminator;
    const t = this.name('t');
    const tagPath = this.keyOf(path, JSON.stringify(tag));
    const error = (suffix, kind) =>
      this.emit(
        messageAt(
          tagPath,
          () => `${this.nameOf(tagPath, false)} + ${JSON.stringify(suffix)}`,
          'discriminator',
          `{ error: "${kind}", tag: ${JSON.stringify(tag)}, tagValue: ${t} }`
        )
      );
    const values = [...mapping.keys()];
    const literal = JSON.stringify(tag);
    // The tag is an own property, read like the keys of a Schema (see schema()): a value read from a plain object is
    // its own unless Object.prototype has the key. Whether the object is plain is worked out here, once for the
    // alternatives too, unless an enclosing allOf did.
    const plain = `${this.scope}:${v}`;
    const declares = !this.plainDeclared.has(plain);
    this.plainDeclared.add(plain);
    const isPlainOwn = tag in Object.prototype ? '' : `${v}plain || `;
    let code = declares ? `const ${v}plain = ${v}.__proto__ === OP;\n` : '';
    code += `let ${t} = ${v}[${literal}];\n`;
    code += `if (${t} !== undefined && !(${isPlainOwn}H.call(${v}, ${literal}))) { ${t} = undefined; }\n`;
    type.types.forEach((item, i) => {
      const picks = values
        .filter((value) => mapping.get(value) === i)
        .map((value) => `${t} === ${JSON.stringify(value)}`);
      // The value is known to be an object, which the alternative does not check again.
      let branch = this.generate(item, v, path, 'object');
      if (record) {
        const matched = record.vars[i];
        const onFail = this.mode === 'check' ? this.fail : this.generate(item, v, path, 'object');
        branch = `${this.inlineCheck(item, v, `${matched} = true;`)}if (!${matched}) {\n${onFail}}\n`;
      }
      code += `${i ? 'else ' : ''}if (${picks.join(' || ')}) {\n${branch}}\n`;
    });
    if (declares) {
      this.plainDeclared.delete(plain);
    }
    // The same alternatives without the discriminator, one node for each oneOf, so they share one function.
    if (!this.plainOneOfs.has(type)) {
      this.plainOneOfs.set(type, new OneOfType({ types: type.types, isMandatory: false, isNullable: true }));
    }
    const rest = others || this.callFunction(this.plainOneOfs.get(type), v, path);
    if (auto) {
      // No alternative accepts a tag that picks none (it gives each a "const" or an "enum"), unless it is missing.
      const unknown = this.mode === 'check' ? this.fail : rest;
      code += `else if (${t} === undefined) {\n${rest}} else {\n${unknown}}\n`;
    } else {
      code += `else if (${t} === undefined) { ${error(' is mandatory', 'tag')} }\n`;
      code += `else if (typeof ${t} !== 'string') { ${error(' must be a string', 'tag')} }\n`;
      code += `else { ${error(valuesMessage(values), 'mapping')} }\n`;
    }
    return `if (typeof ${v} === 'object' && !Array.isArray(${v})) {\n${code}} else {\n${rest}}\n`;
  }

  // Code assigning the defaults ([{ key, value, empty }], see assignDefaults()) missing in the object or array in `v`:
  // each validation assigns a new copy.
  defaultsCode(v, defaults = []) {
    return defaults
      .map((entry) => {
        const property = `${v}[${JSON.stringify(entry.key)}]`;
        return `if (${missingCode(property, entry)}) { ${property} = ${this.copyCode(entry.value)}; }\n`;
      })
      .join('');
  }

  // Code converting the value in variable `x` for a schema with `spec` (see coerce() in coerce.js) and, with `place`,
  // writing the converted value there (the property or element it was read from).
  coerceCode(spec, x, place = undefined) {
    if (!spec) {
      return '';
    }
    const matches = (value) => spec.types.map((type) => COERCE_TYPE_TESTS[type](value)).join(' || ');
    const c = this.name('c');
    const t = this.name('t');
    let code = `if (${x} !== undefined && !(${matches(x)})) {\nlet ${c};\n`;
    if (spec.array) {
      code += `if (Array.isArray(${x}) && ${x}.length === 1) {\n${x} = ${x}[0];\nif (${matches(x)}) { ${c} = ${x}; }\n}\n`;
    }
    const conversions = spec.to.flatMap((type) => COERCE_CODE[type](x, t));
    code += `const ${t} = typeof ${x};\nif (${c} === undefined) {\n`;
    code += conversions
      .map(([condition, value], i) => `${i ? 'else ' : ''}if (${condition}) { ${c} = ${value}; }\n`)
      .join('');
    code += `}\nif (${c} !== undefined) { ${x} = ${c};${place ? ` ${place} = ${c};` : ''} }\n}\n`;
    return code;
  }

  // Code of a new copy of a default value.
  copyCode(value) {
    const copy = literalCode(value);
    return copy === undefined ? `${this.constant(copyDefault)}(${this.constant(value)})` : copy;
  }

  // A keyword of your own, like KeywordType.validate(): its function is called with the value, when the value is of
  // one of its JSON types.
  keyword(type, v, path, name) {
    const applies = type.jsonTypes
      ? `(${type.jsonTypes.map((jsonType) => KEYWORD_TYPE_CHECKS[jsonType](v)).join(' || ')}) && `
      : '';
    const text =
      typeof type.message === 'function'
        ? () => `${name} + " " + ${this.constant(type.message)}(${v})`
        : () => `${name} + ${JSON.stringify(` ${type.message}`)}`;
    const passes =
      type.check instanceof RegExp ? `${this.constant(type.check)}.test(${v})` : `${this.constant(type.check)}(${v})`;
    return [`${applies}!${passes}`, messageAt(path, text, type.keyword)];
  }

  arrayOf(type, v, path, name, text, known) {
    const checks =
      known === 'array' ? [] : [[`!Array.isArray(${v})`, text(' must be an array', 'type', "{ type: 'array' }")]];
    if (type.min !== undefined) {
      checks.push([
        `${v}.length < ${this.number(type.min)}`,
        text(` must have at least ${type.min} elements`, 'minItems', `{ limit: ${this.number(type.min)} }`),
      ]);
    }
    if (type.max !== undefined) {
      checks.push([
        `${v}.length > ${this.number(type.max)}`,
        text(` must have at most ${type.max} elements`, 'maxItems', `{ limit: ${this.number(type.max)} }`),
      ]);
    }
    if (type.unique) {
      checks.push([`${this.constant(hasDuplicates)}(${v})`, text(' must not have duplicate elements', 'uniqueItems')]);
    }
    const min = type.minContains === undefined ? 1 : type.minContains;
    if (type.contains && (min !== 1 || type.maxContains !== undefined)) {
      // Counts only as far as the limits need, like ArrayOfType.countMatches().
      const count = this.name('count');
      const i = this.name('i');
      const x = this.name('v');
      const stop = type.maxContains === undefined ? min : type.maxContains + 1;
      const pre = `let ${count} = 0;\nfor (let ${i} = 0; ${i} < ${v}.length && ${count} < ${this.number(
        stop
      )}; ${i} += 1) {\nconst ${x} = ${v}[${i}];\n${this.inlineCheck(type.contains, x, `${count} += 1;`)}}\n`;
      const containsChecks = [];
      if (min > 0) {
        const atLeast = min === 1 ? 'one matching element' : `${min} matching elements`;
        containsChecks.push([
          `${count} < ${this.number(min)}`,
          text(` must contain at least ${atLeast}`, 'minContains', `{ limit: ${this.number(min)} }`),
        ]);
      }
      if (type.maxContains !== undefined) {
        const atMost = type.maxContains === 1 ? 'one matching element' : `${type.maxContains} matching elements`;
        containsChecks.push([
          `${count} > ${this.number(type.maxContains)}`,
          text(` must contain at most ${atMost}`, 'maxContains', `{ limit: ${this.number(type.maxContains)} }`),
        ]);
      }
      if (containsChecks.length > 0) {
        containsChecks[0].push(pre);
        checks.push(...containsChecks);
      }
    } else if (type.contains) {
      // Runs only when the checks before it pass, like ArrayOfType.countMatches().
      const found = this.name('found');
      const i = this.name('i');
      const x = this.name('v');
      const pre = `let ${found} = false;\nfor (let ${i} = 0; ${i} < ${v}.length && !${found}; ${i} += 1) {\nconst ${x} = ${v}[${i}];\n${this.inlineCheck(
        type.contains,
        x,
        `${found} = true;`
      )}}\n`;
      checks.push([`!${found}`, text(' must contain at least one matching element', 'contains'), pre]);
    }
    let rest = '';
    const defaults = this.defaultsCode(v, type.defaults);
    if (defaults) {
      const first = known === 'array' ? 0 : 1;
      if (checks.length > first) {
        const [condition, message, pre = ''] = checks[first];
        checks[first] = [condition, message, defaults + pre];
      } else {
        rest += defaults;
      }
    }
    if (Array.isArray(type.type)) {
      type.type.forEach((item, i) => {
        const x = this.name('v');
        rest += `let ${x} = ${v}[${i}];\n${this.coerceCode(coerceSpecOf(item), x, `${v}[${i}]`)}`;
        rest += this.generate(item, x, this.indexOf(path, name, i));
      });
      if (type.additionalType) {
        const i = this.name('i');
        const x = this.name('v');
        rest += `for (let ${i} = ${type.type.length}; ${i} < ${v}.length; ${i} += 1) {\nlet ${x} = ${v}[${i}];\n`;
        rest += this.coerceCode(coerceSpecOf(type.additionalType), x, `${v}[${i}]`);
        rest += `${this.generate(type.additionalType, x, this.indexOf(path, name, i))}}\n`;
      }
    } else if (type.type) {
      const i = this.name('i');
      const x = this.name('v');
      rest += `for (let ${i} = 0; ${i} < ${v}.length; ${i} += 1) {\nlet ${x} = ${v}[${i}];\n`;
      rest += this.coerceCode(coerceSpecOf(type.type), x, `${v}[${i}]`);
      rest += `${this.generate(type.type, x, this.indexOf(path, name, i))}}\n`;
    }
    return { checks, rest };
  }

  // Name of a function (x, s) that adds to the Set s the keys (kind 'properties') or the indexes ('items') of the
  // value x that `types` evaluate, and returns true when they evaluate all of them, like evaluated() in
  // unevaluated.js. `key` names the function: a type, or an UnevaluatedType for the group of its siblings.
  evaluatedFunction(kind, key, types) {
    const functions = this.evaluatedFunctions[kind];
    if (!functions.has(key)) {
      const name = this.name('evaluated');
      functions.set(key, name);
      const body = this.inScope(() => types.map((item) => this.evaluatedCode(kind, item)).join(''));
      this.functions.push(`function ${name}(x, s) {\n${body}return false;\n}\n`);
    }
    return functions.get(key);
  }

  // Condition on the key in variable `k`: one of the keys or patterns in `known`. Empty when there are none.
  acceptedKey(known, k) {
    const keys = [...known.keys];
    const declared =
      keys.length <= MAX_INLINE_KEYS
        ? keys.map((key) => `${k} === ${JSON.stringify(key)}`)
        : [`${this.constant(known.keys)}.has(${k})`];
    const terms = [...declared, ...known.patterns.map((pattern) => `${this.constant(pattern)}.test(${k})`)];
    // In parentheses, so it can be combined with && in a larger condition.
    return terms.length > 1 ? `(${terms.join(' || ')})` : terms.join('');
  }

  // Statements of an evaluated function (value in x, Set in s) for a part that evaluates the same for every value.
  staticEvaluatedCode(kind, known) {
    if (known.all) {
      return 'return true;\n';
    }
    if (kind === 'items') {
      const i = this.name('i');
      return known.prefix > 0
        ? `for (let ${i} = 0; ${i} < ${known.prefix} && ${i} < x.length; ${i} += 1) { s.add(${i}); }\n`
        : '';
    }
    const k = this.name('k');
    const accepted = this.acceptedKey(known, k);
    return accepted ? `for (const ${k} in x) {\nif (H.call(x, ${k}) && (${accepted})) { s.add(${k}); }\n}\n` : '';
  }

  // Statements of an evaluated function (value in x, Set in s) for what `type` evaluates.
  evaluatedCode(kind, type) {
    const known = staticEvaluatedBy(kind, type);
    if (known !== undefined) {
      return this.staticEvaluatedCode(kind, known);
    }
    const check = (item) => this.checkFunction(item);
    const code = (item) => this.evaluatedCode(kind, item);
    const onMatch = (item) => `if (${check(item)}(x)) {\n${code(item)}}\n`;
    switch (type.constructor) {
      case Schema:
      case ClosedSchema: {
        // Only its "dependentSchemas" depend on the value.
        const declared = {
          all: false,
          keys: new Set(type.propertyKeys || type.keys),
          patterns: type.patternTypes.map(({ pattern }) => pattern),
          prefix: 0,
        };
        let result = this.staticEvaluatedCode(kind, declared);
        type.dependencies
          .filter((dependency) => dependency.type)
          .forEach((dependency) => {
            result += `if (H.call(x, ${JSON.stringify(dependency.key)})) {\n${onMatch(dependency.type)}}\n`;
          });
        return result;
      }
      case ArrayOfType: {
        // Only its "contains" depends on the value.
        const prefix = Array.isArray(type.type) ? type.type.length : 0;
        const i = this.name('i');
        const tuple = this.staticEvaluatedCode(kind, {
          all: false,
          keys: new Set(),
          patterns: [],
          prefix,
        });
        const contains = `if (${check(type.contains)}(x[${i}])) { s.add(${i}); }\n`;
        return `${tuple}for (let ${i} = 0; ${i} < x.length; ${i} += 1) {\n${contains}}\n`;
      }
      case AllOfType:
        return type.types.map(code).join('');
      case AnyOfType:
        return type.types.map(onMatch).join('');
      case OneOfType: {
        // What the one alternative that matches evaluates, when exactly one does. With a discriminator, only the one
        // it picks can match.
        const oks = type.types.map(() => this.name('ok'));
        const d = this.name('d');
        const pick = type.discriminator ? this.pickCode(type, 'x', d) : '';
        const picks = (i) => (type.discriminator ? `(${d} === ${EVERY_TYPE} || ${d} === ${i}) && ` : '');
        const matches =
          pick + type.types.map((item, i) => `const ${oks[i]} = ${picks(i)}${check(item)}(x);\n`).join('');
        const chosen = type.types.map((item, i) => `if (${oks[i]}) {\n${code(item)}}\n`).join('');
        return `${matches}if (${oks.join(' + ')} === 1) {\n${chosen}}\n`;
      }
      case ConditionalType: {
        // What "if" evaluates counts when the value satisfies it, with the branch taken.
        const branch = (item) => (item ? onMatch(item) : '');
        const ifTrue = `${code(type.ifType)}${branch(type.thenType)}`;
        return `if (${check(type.ifType)}(x)) {\n${ifTrue}} else {\n${branch(type.elseType)}}\n`;
      }
      case RefType: {
        const target = type.getTarget();
        return `if (${this.evaluatedFunction(kind, target, [target])}(x, s)) { return true; }\n`;
      }
      case WhenType:
        return type.jsonType === JSON_TYPES[kind] ? code(type.type) : '';
      case UnevaluatedType: {
        // Evaluates everything the other keywords leave, when those elements satisfy it.
        const siblings = type.siblings.map(code).join('');
        return type.kind === kind ? `if (${check(type)}(x)) { return true; }\n${siblings}` : siblings;
      }
      default:
        return '';
    }
  }

  // Condition that is true when `type` evaluates the key (kind 'properties') or index ('items') in variable `k` of the
  // value in `v`, like evaluated() in unevaluated.js. It adds to `prelude` the statements that compute, once, which
  // subschemas the value satisfies. Undefined when a reference leads to a part that depends on the value, which may
  // be recursive: an evaluated function handles that case.
  evaluatedCondition(kind, type, v, k, prelude) {
    const known = staticEvaluatedBy(kind, type);
    if (known !== undefined) {
      if (known.all) {
        return 'true';
      }
      if (kind === 'items') {
        return known.prefix > 0 ? `${k} < ${known.prefix}` : 'false';
      }
      return this.acceptedKey(known, k) || 'false';
    }
    const matches = (item) => {
      const ok = this.name('ok');
      prelude.push(`const ${ok} = ${this.checkFunction(item)}(${v});\n`);
      return ok;
    };
    const condition = (item) => this.evaluatedCondition(kind, item, v, k, prelude);
    const any = (parts) => (parts.some((part) => part === undefined) ? undefined : `(${parts.join(' || ')})`);
    switch (type.constructor) {
      case Schema:
      case ClosedSchema: {
        // Only its "dependentSchemas" depend on the value.
        const declared = {
          keys: new Set(type.propertyKeys || type.keys),
          patterns: type.patternTypes.map(({ pattern }) => pattern),
        };
        const parts = [this.acceptedKey(declared, k) || 'false'];
        type.dependencies
          .filter((dependency) => dependency.type)
          .forEach((dependency) => {
            const ok = this.name('ok');
            const literal = JSON.stringify(dependency.key);
            prelude.push(`const ${ok} = H.call(${v}, ${literal}) && ${this.checkFunction(dependency.type)}(${v});\n`);
            const inner = condition(dependency.type);
            parts.push(inner === undefined ? undefined : `(${ok} && ${inner})`);
          });
        return any(parts);
      }
      case ArrayOfType: {
        // Only its "contains" depends on the value.
        const prefix = Array.isArray(type.type) ? type.type.length : 0;
        const contains = `${this.checkFunction(type.contains)}(${v}[${k}])`;
        return prefix > 0 ? `(${k} < ${prefix} || ${contains})` : contains;
      }
      case AllOfType:
        return any(type.types.map(condition));
      case AnyOfType:
        return any(
          type.types.map((item) => {
            const inner = condition(item);
            return inner === undefined ? undefined : `(${matches(item)} && ${inner})`;
          })
        );
      case OneOfType: {
        // What the one alternative that matches evaluates, when exactly one does. The oneOf may have recorded which
        // match already.
        let oks = this.matchesOf(type, v);
        if (!oks && type.discriminator) {
          // Only the alternative the discriminator picks can match.
          const d = this.name('d');
          prelude.push(this.pickCode(type, v, d));
          oks = type.types.map((item, i) => {
            const ok = this.name('ok');
            prelude.push(
              `const ${ok} = (${d} === ${EVERY_TYPE} || ${d} === ${i}) && ${this.checkFunction(item)}(${v});\n`
            );
            return ok;
          });
        }
        oks = oks || type.types.map(matches);
        const one = this.name('one');
        prelude.push(`const ${one} = ${oks.join(' + ')} === 1;\n`);
        const chosen = any(
          type.types.map((item, i) => {
            const inner = condition(item);
            return inner === undefined ? undefined : `(${oks[i]} && ${inner})`;
          })
        );
        return chosen === undefined ? undefined : `(${one} && ${chosen})`;
      }
      case ConditionalType: {
        // What "if" evaluates counts when the value satisfies it, with the branch taken.
        const okIf = matches(type.ifType);
        const parts = [];
        const ifPart = condition(type.ifType);
        parts.push(ifPart === undefined ? undefined : `(${okIf} && ${ifPart})`);
        [
          [type.thenType, okIf],
          [type.elseType, `!${okIf}`],
        ].forEach(([branch, taken]) => {
          if (branch) {
            const ok = this.name('ok');
            prelude.push(`const ${ok} = ${taken} && ${this.checkFunction(branch)}(${v});\n`);
            const inner = condition(branch);
            parts.push(inner === undefined ? undefined : `(${ok} && ${inner})`);
          }
        });
        return any(parts);
      }
      case WhenType:
        return type.jsonType === JSON_TYPES[kind] ? condition(type.type) : 'false';
      case UnevaluatedType: {
        // Evaluates everything the other keywords leave, when those elements satisfy it.
        const siblings = any(type.siblings.map(condition));
        if (type.kind !== kind || siblings === undefined) {
          return siblings;
        }
        return `(${matches(type)} || ${siblings})`;
      }
      case RefType:
        // Its target depends on the value (a fixed one is handled above), and may lead back here.
        return undefined;
      default:
        return 'false';
    }
  }

  // "unevaluatedProperties"/"unevaluatedItems": a loop over the keys or elements the other keywords leave. The loop
  // skips directly what the keywords that evaluate the same for every value evaluate, like "additionalProperties",
  // and what the others evaluate for the value through a condition on the subschemas it satisfies (or, when a
  // reference makes that impossible, through a Set that a generated function fills first).
  unevaluated(type, v, path, name) {
    const isFixed = (item) => staticEvaluatedBy(type.kind, item) !== undefined;
    const known = staticEvaluatedByAll(type.kind, type.siblings.filter(isFixed));
    const varying = type.siblings.filter((item) => !isFixed(item));
    if (known.all) {
      return { checks: [], rest: '' };
    }
    // Key (or index) variable of the loop, and the condition for what the varying siblings evaluate.
    const k = this.name(type.kind === 'items' ? 'i' : 'k');
    const prelude = [];
    const conditions = varying.map((item) => this.evaluatedCondition(type.kind, item, v, k, prelude));
    let evaluated = conditions.includes(undefined) ? undefined : conditions.join(' || ');
    let collect = prelude.join('');
    let close = '';
    if (evaluated === undefined) {
      const done = this.name('done');
      collect = `const ${done} = new Set();\nif (!${this.evaluatedFunction(type.kind, type, varying)}(${v}, ${done})) {\n`;
      close = '}\n';
      evaluated = `${done}.has(${k})`;
    }
    const x = this.name('v');
    if (type.kind === 'items') {
      const code = this.generate(type.type, x, this.indexOf(path, name, k));
      if (!code) {
        return { checks: [], rest: '' };
      }
      const skip = evaluated ? `if (${evaluated}) { continue; }\n` : '';
      let rest = `if (Array.isArray(${v})) {\n${collect}for (let ${k} = ${known.prefix}; ${k} < ${v}.length; ${k} += 1) {\n`;
      rest += `${skip}const ${x} = ${v}[${k}];\n${code}}\n${close}}\n`;
      return { checks: [], rest };
    }
    const keyName = this.keyOf(path, k);
    let code;
    if (type.type.constructor === NeverType) {
      const unexpected = () => `"Unexpected key: " + ${this.nameOf(keyName, false)}`;
      code = this.emit(messageAt(keyName, unexpected, 'unevaluatedProperties', `{ property: ${k} }`));
    } else {
      const inner = this.generate(type.type, x, keyName);
      // A schema that accepts every value gives no code.
      if (!inner) {
        return { checks: [], rest: '' };
      }
      code = `const ${x} = ${v}[${k}];\n${inner}`;
    }
    const accepted = [this.acceptedKey(known, k), evaluated].filter(Boolean).join(' || ');
    const skip = accepted ? ` || ${accepted}` : '';
    let rest = `if (typeof ${v} === 'object' && !Array.isArray(${v})) {\n${collect}for (const ${k} in ${v}) {\n`;
    rest += `if (!H.call(${v}, ${k})${skip}) { continue; }\n${code}}\n${close}}\n`;
    return { checks: [], rest };
  }

  // Same order as Schema.errors(): declared keys, then extra keys, then property counts.
  schema(type, v, path, name, text, known) {
    let keysCode = '';
    // A key read to check it gets its default as it is read; the others get it first (see defaultsCode()).
    const defaultOf = new Map((type.defaults || []).map((entry) => [entry.key, entry]));
    type.keys.forEach((key) => {
      const x = this.name('v');
      const literal = JSON.stringify(key);
      const code = this.generate(type.schema[key], x, this.keyOf(path, literal));
      // A key whose type accepts anything is not read.
      if (code) {
        // Own properties only, like Schema's ownValue(). A value read from a plain object is its own unless
        // Object.prototype has the key, so the slower own-property check only runs in that case or for other
        // prototypes. The prototype is read with __proto__, as there: Object.getPrototypeOf() halves the speed.
        keysCode += `let ${x} = ${v}[${literal}];\n`;
        const isOwn = `(!${v}plain || ${literal} in OP) && !H.call(${v}, ${literal})`;
        const entry = defaultOf.get(key);
        if (entry) {
          defaultOf.delete(key);
          const copy = `${x} = ${v}[${literal}] = ${this.copyCode(entry.value)};`;
          keysCode += `if (${missingCode(x, entry)}) { ${copy} } else if (${isOwn}) { ${x} = undefined; }\n`;
        } else {
          keysCode += `if (${x} !== undefined && ${isOwn}) { ${x} = undefined; }\n`;
        }
        // With coerceTypes, the value is converted to the types of its schema and written back.
        keysCode += this.coerceCode(coerceSpecOf(type.schema[key]), x, `${v}[${literal}]`);
        keysCode += code;
      } else if (defaultOf.has(key)) {
        // Not read, but its default is assigned in the order of the keys, as ajv does.
        keysCode += this.defaultsCode(v, [defaultOf.get(key)]);
        defaultOf.delete(key);
      }
    });
    // An enclosing allOf of the same function may have worked it out already.
    const isDeclared = this.plainDeclared.has(`${this.scope}:${v}`);
    let rest = keysCode && !isDeclared ? `const ${v}plain = ${v}.__proto__ === OP;\n${keysCode}` : keysCode;
    // The defaults of the keys not read are assigned first, like Schema.isValid() does with all of them.
    rest = this.defaultsCode(v, [...defaultOf.values()]) + rest;
    const checkExtra = !type.isOpen || type.additionalType || type.removeAdditional;
    const countKeys = type.minProperties !== undefined || type.maxProperties !== undefined;
    const { patternTypes } = type;
    if (checkExtra || countKeys || patternTypes.length > 0 || type.propertyNameType) {
      const count = this.name('count');
      const k = this.name('k');
      const keyName = this.keyOf(path, k);
      rest += `let ${count} = 0;\nfor (const ${k} in ${v}) {\n`;
      rest += `if (!H.call(${v}, ${k})) { continue; }\n${count} += 1;\n`;
      if (type.propertyNameType) {
        rest += this.generate(type.propertyNameType, k, this.propertyNameOf(path, k));
      }
      // Keys matching a pattern satisfy its type and are not extra keys, like Schema.errors().
      const matched = this.name('matched');
      this.mayRepeat = this.mayRepeat || patternTypes.length > 1;
      if (patternTypes.length > 0) {
        rest += `let ${matched} = false;\n`;
        patternTypes.forEach(({ pattern, type: patternType }) => {
          const x = this.name('v');
          rest += `if (${this.constant(pattern)}.test(${k})) {\n${matched} = true;\nlet ${x} = ${v}[${k}];\n`;
          rest += this.coerceCode(coerceSpecOf(patternType), x, `${v}[${k}]`);
          rest += `${this.generate(patternType, x, keyName)}}\n`;
        });
      }
      if (checkExtra) {
        // With removeAdditional, a key only "required" names is additional (see Schema.isDeclared()).
        const keys = type.removeAdditional && type.propertyKeys ? type.propertyKeys : type.keys;
        const declared =
          keys.length <= MAX_INLINE_KEYS
            ? keys.map((key) => `${k} === ${JSON.stringify(key)}`).join(' || ') || 'false'
            : `${this.constant(new Set(keys))}.has(${k})`;
        const accepted = patternTypes.length > 0 ? `${declared} || ${matched}` : declared;
        rest += `if (!(${accepted})) {\n`;
        // removeAdditional: the key is deleted (see Schema.removes()). It still counts for minProperties and
        // maxProperties, as in ajv.
        const remove = `delete ${v}[${k}];\n`;
        if (type.removeAdditional === 'delete') {
          rest += remove;
        } else if (type.removeAdditional === 'failing') {
          rest += `if (!${this.checkFunction(type.additionalType)}(${v}[${k}])) {\n${remove}}\n`;
        } else if (!type.isOpen) {
          const unexpected = () => `"Unexpected key: " + ${this.nameOf(keyName, false)}`;
          rest += this.emit(messageAt(keyName, unexpected, 'additionalProperties', `{ property: ${k} }`));
        } else {
          const x = this.name('v');
          rest += `let ${x} = ${v}[${k}];\n${this.coerceCode(coerceSpecOf(type.additionalType), x, `${v}[${k}]`)}`;
          rest += this.generate(type.additionalType, x, keyName);
        }
        rest += '}\n';
      }
      rest += '}\n';
      if (type.minProperties !== undefined) {
        const message = text(
          ` must have at least ${type.minProperties} properties`,
          'minProperties',
          `{ limit: ${this.number(type.minProperties)} }`
        );
        rest += `if (${count} < ${this.number(type.minProperties)}) { ${this.emit(message)} }\n`;
      }
      if (type.maxProperties !== undefined) {
        const message = text(
          ` must have at most ${type.maxProperties} properties`,
          'maxProperties',
          `{ limit: ${this.number(type.maxProperties)} }`
        );
        rest += `if (${count} > ${this.number(type.maxProperties)}) { ${this.emit(message)} }\n`;
      }
    }
    rest += this.dependencies(type, v, path);
    return {
      checks:
        known === 'object'
          ? []
          : [
              [
                `typeof ${v} !== 'object' || Array.isArray(${v})`,
                text(' must be an object', 'type', "{ type: 'object' }"),
              ],
            ],
      rest,
    };
  }

  // Like Schema.errors(): a key is present when it is an own property that is not undefined.
  dependencies(type, v, path) {
    const isPresent = (literal) => `(H.call(${v}, ${literal}) && ${v}[${literal}] !== undefined)`;
    return type.dependencies
      .map(({ key, required, type: dependentType }) => {
        const literal = JSON.stringify(key);
        let code;
        if (required) {
          code = required
            .map((property) => {
              const propertyLiteral = JSON.stringify(property);
              // About the property that is missing.
              const missing = this.keyOf(path, propertyLiteral);
              const present = this.nameOf(this.keyOf(path, literal), false);
              const text = () => `${this.nameOf(missing, false)} + " is mandatory when " + ${present} + " is present"`;
              const params = `{ property: ${literal}, missingProperty: ${propertyLiteral} }`;
              const message = messageAt(missing, text, 'dependentRequired', params);
              return `if (!${isPresent(propertyLiteral)}) { ${this.emit(message)} }\n`;
            })
            .join('');
        } else {
          code = this.generate(dependentType, v, path);
        }
        return `if (${isPresent(literal)}) {\n${code}}\n`;
      })
      .join('');
  }

  // Source of the body of a function that takes the constants (c), the nodes (n) and the helpers r and a, and returns
  // the validation function. standalone.js writes it out with the constants as code.
  source(type) {
    const main = this.generate(type, 'v0', this.rootPath());
    // Every error once, like toErrors(): parts of an allOf, or alternatives, can report the same one.
    const results = {
      check: ['', 'true'],
      first: ['', 'undefined'],
      all: [
        'let out;\n',
        this.mayRepeat ? '(out === undefined ? [] : out.length > 1 ? U(out) : out)' : '(out === undefined ? [] : out)',
      ],
    };
    const [declared, end] = results[this.mode];
    // The variable of the paths of error objects (see emit()).
    const start = this.structured && this.mode !== 'check' ? `${declared}let q;\n` : declared;
    const prologue = [
      '"use strict";',
      'const H = Object.prototype.hasOwnProperty;',
      'const OP = Object.prototype;',
      'function J(fieldName, key) { return fieldName ? fieldName + "." + key : key; }',
      // Adds an error to the list, which is made with the first one.
      'function P(out, e) { if (out === undefined) { return [e]; } out.push(e); return out; }',
      // The list itself when no error repeats, which is the usual case: a new list is only built when one does. Error
      // objects repeat when their messages do.
      this.structured
        ? 'function U(e) { const m = e.map((x) => x.message); for (let i = 1; i < m.length; i += 1) { if (m.indexOf(m[i]) < i) { return e.filter((x, j) => m.indexOf(m[j]) === j); } } return e; }'
        : 'function U(e) { for (let i = 1; i < e.length; i += 1) { if (e.indexOf(e[i]) < i) { return Array.from(new Set(e)); } } return e; }',
      '',
    ].join('\n');
    return `${prologue}${this.functions.join('')}return function validate(v0) {\n${start}${main}return ${end};\n};`;
  }

  build(type) {
    const source = this.source(type);
    const [first, push] = this.structured ? [firstErrorObject, pushErrorObjects] : [firstError, pushErrors];
    // eslint-disable-next-line no-new-func -- code generation is the point: only keys, texts (JSON.stringify) and finite numbers are embedded
    return new Function('c', 'n', 'r', 'a', source)(this.constants, this.nodes, first, push);
  }
}

// Returns a (value) => boolean function equivalent to type.isValid(value).
function compileIsValid(type) {
  return new Generator('check').build(type);
}

// Returns a (value) => message | undefined function giving the first error of type.validate(value).
function compileFirstError(type) {
  return new Generator('first').build(type);
}

// Returns a (value) => messages function equivalent to toErrors(type.errors(value)) for invalid values, and giving
// an empty array for valid ones.
function compileErrors(type) {
  return new Generator('all').build(type);
}

// Returns a (value) => errors function: every error message by default (empty when valid), or with
// allErrors: false only the first one, which stops at the first failing check.
// With errors: false it returns a (value) => boolean function instead, which builds no messages at all.
// The mode of the generated code for the options of compileType(): 'check', 'first' or 'all'.
// The mode of the generated code for the options of compileType() ('check', 'first' or 'all'), and whether errors are
// objects. errors: true (default) gives messages, 'objects' error objects (see error-objects.js), false true or false.
function modeOf(options = {}) {
  const { allErrors = true, errors = true } = options;
  if (errors !== true && errors !== false && errors !== 'objects') {
    throw new Error(`Unsupported option "errors": ${JSON.stringify(errors)} is not true, false or 'objects'`);
  }
  if (errors === false) {
    return { mode: 'check', structured: false };
  }
  return {
    mode: allErrors ? 'all' : 'first',
    structured: errors === 'objects',
  };
}

// The generated code of compileType(type, options), for standalone.js: the source (see Generator.source()), with
// the constants and the nodes it uses, and its mode.
function generateSource(type, options = {}) {
  const { mode, structured } = modeOf(options);
  const generator = new Generator(mode, structured);
  const source = generator.source(type);
  return {
    mode,
    source,
    constants: generator.constants,
    nodes: generator.nodes,
  };
}

function compileType(type, options = {}) {
  const { mode, structured } = modeOf(options);
  // In 'all' mode one pass: checking validity first would walk invalid values twice.
  const validate = new Generator(mode, structured).build(type);
  if (mode !== 'first') {
    return validate;
  }
  // The first error in a list.
  return (value) => {
    const error = validate(value);
    return error === undefined ? [] : [error];
  };
}

module.exports = {
  generateSource,
  compileErrors,
  compileFirstError,
  compileIsValid,
  compileType,
};
