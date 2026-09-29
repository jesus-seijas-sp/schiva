const { hasFewerCodePoints, hasMoreCodePoints } = require('./code-point-length');
const { ValidateType } = require('./validate-type');

class StringType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.min = options.min;
    this.max = options.max;
    this.pattern = options.pattern;
    this.allowEmpty = options.allowEmpty;
    // Count min/max in Unicode code points (as JSON Schema does) instead of UTF-16 units.
    this.countCodePoints = options.countCodePoints;
  }

  isTooShort(value) {
    return this.countCodePoints ? hasFewerCodePoints(value, this.min) : value.length < this.min;
  }

  isTooLong(value) {
    return this.countCodePoints ? hasMoreCodePoints(value, this.max) : value.length > this.max;
  }

  validate(value, fieldName = 'Value') {
    const result = super.validate(value, fieldName);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null) {
      if (typeof value !== 'string') {
        return `${fieldName} must be a string`;
      }
      const skipMin = value.length === 0 && (this.allowEmpty ?? !this.isMandatory);
      if (this.min !== undefined && !skipMin && this.isTooShort(value)) {
        return `${fieldName} must be at least ${this.min} characters long`;
      }
      if (this.max !== undefined && this.isTooLong(value)) {
        return `${fieldName} must be at most ${this.max} characters long`;
      }
      if (this.pattern && !this.pattern.test(value)) {
        return `${fieldName} does not match the required pattern`;
      }
    }
    return undefined;
  }

  isValid(value) {
    const presence = this.checkPresence(value);
    if (presence !== undefined) {
      return presence;
    }
    if (typeof value !== 'string') {
      return false;
    }
    const skipMin = value.length === 0 && (this.allowEmpty ?? !this.isMandatory);
    return (
      (this.min === undefined || skipMin || !this.isTooShort(value)) &&
      (this.max === undefined || !this.isTooLong(value)) &&
      (!this.pattern || this.pattern.test(value))
    );
  }
}

function String(options) {
  return new StringType(options);
}

function str(min, max, isMandatory = true, isNullable = false) {
  if (min !== undefined && min !== null && typeof min === 'object') {
    return new StringType(min);
  }
  return new StringType({ min, max, isMandatory, isNullable });
}

function ostr(min, max, isMandatory = false, isNullable = false) {
  if (min !== undefined && min !== null && typeof min === 'object') {
    return new StringType({ isMandatory: false, ...min });
  }
  return new StringType({ min, max, isMandatory, isNullable });
}

module.exports = {
  StringType,
  String,
  str,
  ostr,
};
