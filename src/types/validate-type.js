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
  // so types whose validate() starts with an isValid() fast path can skip it.
  errors(value, fieldName = 'Value') {
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

function toErrors(result) {
  if (Array.isArray(result)) {
    return result.flat(Infinity);
  }
  return result ? [result] : [];
}

module.exports = {
  ValidateType,
  hasErrors,
  toErrors,
};
