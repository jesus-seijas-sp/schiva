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
const { codePointLength } = require('./types/code-point-length');
const { hasDuplicates } = require('./types/has-duplicates');

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

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

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

function pushErrors(out, type, value, fieldName) {
  const errors = toErrors(type.errors(value, fieldName));
  for (let i = 0; i < errors.length; i += 1) {
    out.push(errors[i]);
  }
}

class Generator {
  constructor(mode) {
    this.mode = mode;
    this.constants = [];
    this.nodes = [];
    this.functions = [];
    this.checkFunctions = new Map();
    // Per mode, the function validating each reference target.
    this.refFunctions = { check: new Map(), first: new Map(), all: new Map() };
    this.count = 0;
    // Nodes being generated, to fall back to their own isValid()/errors() if a tree refers to itself.
    this.visiting = new Set();
    // Statement for a failed check in 'check' mode: a return, or a break out of an inlined check.
    this.fail = 'return false;';
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
  emit(message) {
    if (this.mode === 'check') {
      return this.fail;
    }
    return this.mode === 'first' ? `return ${message()};` : `out.push(${message()});`;
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
    const body = generate();
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
    const body = this.generate(type, v, 'undefined');
    this.mode = mode;
    this.fail = fail;
    if (body.length > MAX_INLINE_CODE) {
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
      const end = { check: 'return true;', first: 'return undefined;', all: '' }[this.mode];
      // The target may be an outer node being generated: its function is generated on its own.
      const { visiting, fail } = this;
      this.visiting = new Set();
      this.fail = 'return false;';
      const body = this.generate(target, 'x', this.mode === 'check' ? 'undefined' : 'p');
      this.visiting = visiting;
      this.fail = fail;
      this.functions.push(`function ${name}(${params}) {\n${body}${end}\n}\n`);
    }
    return functions.get(target);
  }

  // Like RefType: undefined is checked here, any other value by the target.
  ref(type, v, path) {
    const onUndefined = type.isMandatory ? this.emit(() => `${valuePath(path)} + " is mandatory"`) : '';
    const fn = this.refFunction(type.getTarget());
    let call = `if (!${fn}(${v})) { ${this.fail} }\n`;
    if (this.mode === 'first') {
      const e = this.name('e');
      call = `const ${e} = ${fn}(${v}, ${path});\nif (${e} !== undefined) { return ${e}; }\n`;
    } else if (this.mode === 'all') {
      call = `${fn}(${v}, ${path}, out);\n`;
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
    if (this.visiting.has(type)) {
      return this.custom(type, v, path);
    }
    this.visiting.add(type);
    const isSchema = type.constructor === Schema || type.constructor === ClosedSchema;
    const name = isSchema ? schemaName(path) : valuePath(path);
    const body = this.body(type, v, path, name, known);
    this.visiting.delete(type);
    if (body === undefined) {
      return this.custom(type, v, path);
    }
    const checks = this.chain(body.checks, body.rest);
    if (known) {
      return checks;
    }
    const text = (suffix) => () => `${name} + ${JSON.stringify(suffix)}`;
    const onUndefined = type.isMandatory ? this.emit(text(' is mandatory')) : '';
    const onNull = type.isNullable ? '' : this.emit(text(' cannot be null'));
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
      onInvalid = `a(out, ${node}, ${v}, ${path});`;
    }
    return `if (${invalid}) { ${onInvalid} }\n`;
  }

  // Checks for a value that is neither undefined nor null, as { checks, rest }; undefined when the type is not a
  // built-in one.
  body(type, v, path, name, known) {
    const text = (suffix) => () => `${name} + ${JSON.stringify(suffix)}`;
    switch (type.constructor) {
      case Schema:
      case ClosedSchema:
        return this.schema(type, v, path, name, text, known);
      case ObjType:
        return {
          checks: [[`typeof ${v} !== 'object' || Array.isArray(${v})`, text(' must be an object')]],
          rest: type.schema ? this.generate(type.schema, v, name) : '',
        };
      case ArrayOfType:
        return this.arrayOf(type, v, name, text, known);
      case AllOfType:
        return { checks: [], rest: this.allOf(type, v, name) };
      case ConditionalType: {
        // Only the chosen branch is checked and reported, like ConditionalType.validate().
        const branch = (branchType) => (branchType ? this.generate(branchType, v, name) : '');
        const ok = this.name('ok');
        const rest = `let ${ok} = false;\n${this.inlineCheck(type.ifType, v, `${ok} = true;`)}if (${ok}) {\n${branch(
          type.thenType
        )}} else {\n${branch(type.elseType)}}\n`;
        return { checks: [], rest };
      }
      case AnyOfType:
        return { checks: [], rest: this.anyOf(type, v, name) };
      case OneOfType:
        return this.oneOf(type, v, name, text);
      case NotType: {
        const ok = this.name('ok');
        const pre = `let ${ok} = false;\n${this.inlineCheck(type.type, v, `${ok} = true;`)}`;
        return { checks: [[ok, text(' must not match the excluded schema'), pre]] };
      }
      case StringType:
        return { checks: this.string(type, v, text, known) };
      case EnumType:
        return {
          checks: [
            ...this.string(type, v, text, known),
            [`!${this.constant(new Set(type.options))}.has(${v})`, text(` must be one of: ${type.options.join(', ')}`)],
          ],
        };
      case FloatType:
        return { checks: this.float(type, v, text) };
      case IntegerType:
        return { checks: [...this.float(type, v, text), [`!Number.isInteger(${v})`, text(' must be an integer')]] };
      case BooleanType:
        return { checks: [[`typeof ${v} !== 'boolean'`, text(' must be a boolean')]] };
      case AnyType:
        return { checks: [] };
      case NeverType:
        return { checks: [['true', text(' is not allowed')]] };
      case ValuesType:
        return { checks: [[this.notOneOf(type.values, v), text(valuesMessage(type.values))]] };
      case WhenType:
        // The field name goes through unchanged, like WhenType.validate().
        return {
          checks: [],
          rest: `if (${JSON_TYPE_CHECKS[type.jsonType](v)}) {\n${this.generate(type.type, v, path, type.jsonType)}}\n`,
        };
      default:
        return undefined;
    }
  }

  string(type, v, text, known) {
    const checks = known === 'string' ? [] : [[`typeof ${v} !== 'string'`, text(' must be a string')]];
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
        text(` must be at least ${type.min} characters long`),
      ]);
    }
    if (type.max !== undefined) {
      const max = this.number(type.max);
      const tooLong = type.countCodePoints
        ? `(${v}.length > 2 * ${max} || (${v}.length > ${max} && ${count()} > ${max}))`
        : `${v}.length > ${max}`;
      checks.push([tooLong, text(` must be at most ${type.max} characters long`)]);
    }
    if (type.pattern) {
      checks.push([`!${this.constant(type.pattern)}.test(${v})`, text(' does not match the required pattern')]);
    }
    return checks;
  }

  float(type, v, text) {
    const limits = [
      [type.min, '<', 'must be at least'],
      [type.max, '>', 'must be at most'],
      [type.exclusiveMin, '<=', 'must be greater than'],
      [type.exclusiveMax, '>=', 'must be less than'],
    ];
    const checks = [
      [`!Number.isFinite(${v})`, text(' must be a number')],
      ...limits
        .filter(([limit]) => limit !== undefined)
        .map(([limit, operator, message]) => [`${v} ${operator} ${this.number(limit)}`, text(` ${message} ${limit}`)]),
    ];
    if (type.multipleOf !== undefined) {
      checks.push([
        `!Number.isInteger(${v} / ${this.number(type.multipleOf)})`,
        text(` must be a multiple of ${type.multipleOf}`),
      ]);
    }
    return checks;
  }

  // Like ValuesType: `v` (neither undefined nor null) is deep-equal to none of the values. Plain values are compared
  // with code written for them; others with deepEqual(), only for objects as it is false for anything else.
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

  // Errors of the first type that fails, like AllOfType.validate().
  allOf(type, v, name) {
    if (this.mode !== 'all') {
      return type.types.map((item) => this.generate(item, v, name)).join('');
    }
    const failed = this.name('failed');
    let code = `let ${failed} = false;\n`;
    type.types.forEach((item) => {
      const ok = this.name('ok');
      code += `if (!${failed}) {\nlet ${ok} = false;\n${this.inlineCheck(item, v, `${ok} = true;`)}`;
      code += `if (!${ok}) {\n${failed} = true;\n${this.generate(item, v, name)}}\n}\n`;
    });
    return code;
  }

  // Code for a value that no alternative accepts: the errors of every alternative, like AnyOfType.validate().
  noneMatches(types, v, name) {
    if (this.mode === 'check') {
      return this.fail;
    }
    if (this.mode === 'first') {
      return this.generate(types[0], v, name);
    }
    return types.map((item) => this.generate(item, v, name)).join('');
  }

  anyOf(type, v, name) {
    if (!type.types || type.types.length === 0) {
      return '';
    }
    const ok = this.name('ok');
    let code = `let ${ok} = false;\n`;
    type.types.forEach((item, i) => {
      const check = this.inlineCheck(item, v, `${ok} = true;`);
      code += i ? `if (!${ok}) {\n${check}}\n` : check;
    });
    return `${code}if (!${ok}) {\n${this.noneMatches(type.types, v, name)}}\n`;
  }

  // Counts up to two matching alternatives, like OneOfType.countMatches().
  oneOf(type, v, name, text) {
    if (type.types.length === 0) {
      return { checks: [['true', text(' must match exactly one schema, but matches none')]] };
    }
    const m = this.name('m');
    let rest = `let ${m} = 0;\n`;
    type.types.forEach((item, i) => {
      const check = this.inlineCheck(item, v, `${m} += 1;`);
      rest += i > 1 ? `if (${m} < 2) {\n${check}}\n` : check;
    });
    const more = this.emit(text(' must match exactly one schema, but matches more than one'));
    if (this.mode === 'check') {
      rest += `if (${m} !== 1) { ${this.fail} }\n`;
    } else {
      rest += `if (${m} === 0) {\n${this.noneMatches(type.types, v, name)}} else if (${m} > 1) { ${more} }\n`;
    }
    return { checks: [], rest };
  }

  arrayOf(type, v, name, text, known) {
    const checks = known === 'array' ? [] : [[`!Array.isArray(${v})`, text(' must be an array')]];
    if (type.min !== undefined) {
      checks.push([`${v}.length < ${this.number(type.min)}`, text(` must have at least ${type.min} elements`)]);
    }
    if (type.max !== undefined) {
      checks.push([`${v}.length > ${this.number(type.max)}`, text(` must have at most ${type.max} elements`)]);
    }
    if (type.unique) {
      checks.push([`${this.constant(hasDuplicates)}(${v})`, text(' must not have duplicate elements')]);
    }
    if (type.contains) {
      // Runs only when the checks before it pass, like ArrayOfType.hasMatch().
      const found = this.name('found');
      const i = this.name('i');
      const x = this.name('v');
      const pre = `let ${found} = false;\nfor (let ${i} = 0; ${i} < ${v}.length && !${found}; ${i} += 1) {\nconst ${x} = ${v}[${i}];\n${this.inlineCheck(
        type.contains,
        x,
        `${found} = true;`
      )}}\n`;
      checks.push([`!${found}`, text(' must contain at least one matching element'), pre]);
    }
    let rest = '';
    if (Array.isArray(type.type)) {
      type.type.forEach((item, i) => {
        const x = this.name('v');
        rest += `const ${x} = ${v}[${i}];\n${this.generate(item, x, `(${name} + "[${i}]")`)}`;
      });
      if (type.additionalType) {
        const i = this.name('i');
        const x = this.name('v');
        rest += `for (let ${i} = ${type.type.length}; ${i} < ${v}.length; ${i} += 1) {\nconst ${x} = ${v}[${i}];\n`;
        rest += `${this.generate(type.additionalType, x, `(${name} + "[" + ${i} + "]")`)}}\n`;
      }
    } else if (type.type) {
      const i = this.name('i');
      const x = this.name('v');
      rest += `for (let ${i} = 0; ${i} < ${v}.length; ${i} += 1) {\nconst ${x} = ${v}[${i}];\n`;
      rest += `${this.generate(type.type, x, `(${name} + "[" + ${i} + "]")`)}}\n`;
    }
    return { checks, rest };
  }

  // Same order as Schema.errors(): declared keys, then extra keys, then property counts.
  schema(type, v, path, name, text, known) {
    let keysCode = '';
    type.keys.forEach((key) => {
      const x = this.name('v');
      const literal = JSON.stringify(key);
      const code = this.generate(type.schema[key], x, keyPath(path, literal));
      // A key whose type accepts anything is not read.
      if (code) {
        // Own properties only, like Schema's ownValue(). A value read from a plain object is its own unless
        // Object.prototype has the key, so the slower own-property check only runs in that case or for other
        // prototypes. The prototype is read with __proto__, as there: Object.getPrototypeOf() halves the speed.
        keysCode += `let ${x} = ${v}[${literal}];\n`;
        keysCode += `if (${x} !== undefined && (!${v}plain || ${literal} in OP) && !H.call(${v}, ${literal})) { ${x} = undefined; }\n`;
        keysCode += code;
      }
    });
    let rest = keysCode ? `const ${v}plain = ${v}.__proto__ === OP;\n${keysCode}` : '';
    const checkExtra = !type.isOpen || type.additionalType;
    const countKeys = type.minProperties !== undefined || type.maxProperties !== undefined;
    const { patternTypes } = type;
    if (checkExtra || countKeys || patternTypes.length > 0 || type.propertyNameType) {
      const count = this.name('count');
      const k = this.name('k');
      const keyName = keyPath(path, k);
      rest += `let ${count} = 0;\nfor (const ${k} in ${v}) {\n`;
      rest += `if (!H.call(${v}, ${k})) { continue; }\n${count} += 1;\n`;
      if (type.propertyNameType) {
        rest += this.generate(type.propertyNameType, k, `("Key " + ${keyName})`);
      }
      // Keys matching a pattern satisfy its type and are not extra keys, like Schema.errors().
      const matched = this.name('matched');
      if (patternTypes.length > 0) {
        rest += `let ${matched} = false;\n`;
        patternTypes.forEach(({ pattern, type: patternType }) => {
          const x = this.name('v');
          rest += `if (${this.constant(pattern)}.test(${k})) {\n${matched} = true;\nconst ${x} = ${v}[${k}];\n`;
          rest += `${this.generate(patternType, x, keyName)}}\n`;
        });
      }
      if (checkExtra) {
        const declared =
          type.keys.length <= MAX_INLINE_KEYS
            ? type.keys.map((key) => `${k} === ${JSON.stringify(key)}`).join(' || ') || 'false'
            : `${this.constant(type.keySet)}.has(${k})`;
        const accepted = patternTypes.length > 0 ? `${declared} || ${matched}` : declared;
        rest += `if (!(${accepted})) {\n`;
        if (!type.isOpen) {
          rest += this.emit(() => `"Unexpected key: " + ${keyName}`);
        } else {
          const x = this.name('v');
          rest += `const ${x} = ${v}[${k}];\n${this.generate(type.additionalType, x, keyName)}`;
        }
        rest += '}\n';
      }
      rest += '}\n';
      if (type.minProperties !== undefined) {
        const message = text(` must have at least ${type.minProperties} properties`);
        rest += `if (${count} < ${this.number(type.minProperties)}) { ${this.emit(message)} }\n`;
      }
      if (type.maxProperties !== undefined) {
        const message = text(` must have at most ${type.maxProperties} properties`);
        rest += `if (${count} > ${this.number(type.maxProperties)}) { ${this.emit(message)} }\n`;
      }
    }
    rest += this.dependencies(type, v, path);
    return {
      checks:
        known === 'object' ? [] : [[`typeof ${v} !== 'object' || Array.isArray(${v})`, text(' must be an object')]],
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
              const message = () =>
                `${keyPath(path, propertyLiteral)} + " is mandatory when " + ${keyPath(path, literal)} + " is present"`;
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

  build(type) {
    const main = this.generate(type, 'v0', 'undefined');
    const results = { check: ['', 'true'], first: ['', 'undefined'], all: ['const out = [];\n', 'out'] };
    const [start, end] = results[this.mode];
    const prologue = [
      '"use strict";',
      'const H = Object.prototype.hasOwnProperty;',
      'const OP = Object.prototype;',
      'function J(fieldName, key) { return fieldName ? fieldName + "." + key : key; }',
      '',
    ].join('\n');
    const source = `${prologue}${this.functions.join('')}return function validate(v0) {\n${start}${main}return ${end};\n};`;
    // eslint-disable-next-line no-new-func -- code generation is the point: only keys, texts (JSON.stringify) and finite numbers are embedded
    return new Function('c', 'n', 'r', 'a', source)(this.constants, this.nodes, firstError, pushErrors);
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
function compileType(type, options = {}) {
  const { allErrors = true, errors = true } = options;
  if (!errors) {
    return compileIsValid(type);
  }
  if (allErrors) {
    // One pass: checking validity first would walk invalid values twice.
    return compileErrors(type);
  }
  const getFirstError = compileFirstError(type);
  return (value) => {
    const error = getFirstError(value);
    return error === undefined ? [] : [error];
  };
}

module.exports = {
  compileErrors,
  compileFirstError,
  compileIsValid,
  compileType,
};
