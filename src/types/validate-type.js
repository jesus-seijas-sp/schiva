// A validate() result is undefined (valid), a string (one error) or a possibly empty array of errors.
function hasErrors(result) {
  if (!Array.isArray(result)) {
    return Boolean(result);
  }
  for (let i = 0; i < result.length; i += 1) {
    const item = result[i];
    if (!Array.isArray(item) || hasErrors(item)) {
      return true;
    }
  }
  return false;
}

class ValidateType {
  constructor(options = {}) {
    this.isMandatory = options.isMandatory !== undefined ? options.isMandatory : true;
    this.isNullable = options.isNullable !== undefined ? options.isNullable : false;
  }

  validate(value, fieldName = 'Value') {
    if (this.isMandatory && value === undefined) {
      return `${fieldName} is mandatory`;
    }
    if (!this.isNullable && value === null) {
      return `${fieldName} cannot be null`;
    }
    return undefined;
  }

  // Fast boolean check equivalent to !hasErrors(this.validate(value)) that builds no messages.
  // Built-in types override it; custom subclasses that only override validate() fall back to it.
  isValid(value) {
    return !hasErrors(this.validate(value));
  }

  // Error messages of a value already known to be invalid; containers call it on their failing children
  // so types whose validate() starts with an isValid() fast path can skip it. The field name goes to validate() as
  // received, which names the value "Value" when there is none.
  errors(value, fieldName = undefined) {
    return this.validate(value, fieldName);
  }

  // Compiles the type into generated code, several times faster than validate(): see compileType() in compile.js for
  // the options. The compiled function does not see changes made to the type afterwards.
  compile(options = {}) {
    // eslint-disable-next-line global-require -- compile.js requires this module
    return require('../compile').compileType(this, options);
  }

  // Presence part of isValid: a boolean when undefined/null decide the result, undefined otherwise.
  checkPresence(value) {
    if (value === undefined) {
      return !this.isMandatory;
    }
    if (value === null) {
      return this.isNullable;
    }
    return undefined;
  }

  mandatory(isMandatory = true) {
    this.isMandatory = isMandatory;
    return this;
  }

  nullable(isNullable = true) {
    this.isNullable = isNullable;
    return this;
  }

  optional() {
    this.isMandatory = false;
    return this;
  }

  required() {
    this.isMandatory = true;
    return this;
  }

  notNull() {
    this.isNullable = false;
    return this;
  }
}

// The messages of a validate() result as a flat list, each one once: parts of an allOf, or alternatives, can report
// the same error.
function toErrors(result) {
  if (Array.isArray(result)) {
    return Array.from(new Set(result.flat(Infinity)));
  }
  return result ? [result] : [];
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Normalizes an option that holds a type. A plain object stands for new Schema(object), as it does for a key of a
// Schema; other objects (types, schemas) are kept; anything else throws now instead of failing when validating.
function toType(value, name) {
  if (value === undefined || value instanceof ValidateType) {
    return value;
  }
  if (isPlainObject(value)) {
    // eslint-disable-next-line global-require -- schema.js requires this module
    const { Schema } = require('../schema');
    return new Schema(value);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be a type or an object of types`);
  }
  return value;
}

function toTypes(values, name) {
  if (values === undefined) {
    return values;
  }
  if (!Array.isArray(values)) {
    throw new TypeError(`${name} must be an array of types`);
  }
  return values.map((value, i) => toType(value, `${name}[${i}]`));
}

module.exports = {
  ValidateType,
  hasErrors,
  toErrors,
  isPlainObject,
  toType,
  toTypes,
};
