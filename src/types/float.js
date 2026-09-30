const { ValidateType } = require('./validate-type');

class FloatType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.min = options.min;
    this.max = options.max;
    this.exclusiveMin = options.exclusiveMin;
    this.exclusiveMax = options.exclusiveMax;
    // Value divided by it must be an integer (floating point division, so 0.3 is not a multiple of 0.1), or with
    // multipleOfPrecision (a number of decimal digits) within 1e-multipleOfPrecision of one, as ajv's option.
    this.multipleOf = options.multipleOf;
    this.multipleOfPrecision = options.multipleOfPrecision;
  }

  isMultiple(value) {
    const division = value / this.multipleOf;
    if (this.multipleOfPrecision === undefined) {
      return Number.isInteger(division);
    }
    // As ajv writes it: a division that is not finite is not "too far" from an integer.
    return !(Math.abs(Math.round(division) - division) > Number(`1e-${this.multipleOfPrecision}`));
  }

  validate(value, fieldName = 'Value') {
    const result = super.validate(value, fieldName);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `${fieldName} must be a number`;
      }
      if (this.min !== undefined && value < this.min) {
        return `${fieldName} must be at least ${this.min}`;
      }
      if (this.max !== undefined && value > this.max) {
        return `${fieldName} must be at most ${this.max}`;
      }
      if (this.exclusiveMin !== undefined && value <= this.exclusiveMin) {
        return `${fieldName} must be greater than ${this.exclusiveMin}`;
      }
      if (this.exclusiveMax !== undefined && value >= this.exclusiveMax) {
        return `${fieldName} must be less than ${this.exclusiveMax}`;
      }
      if (this.multipleOf !== undefined && !this.isMultiple(value)) {
        return `${fieldName} must be a multiple of ${this.multipleOf}`;
      }
    }
    return undefined;
  }

  isValid(value) {
    const presence = this.checkPresence(value);
    if (presence !== undefined) {
      return presence;
    }
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (this.min === undefined || value >= this.min) &&
      (this.max === undefined || value <= this.max) &&
      (this.exclusiveMin === undefined || value > this.exclusiveMin) &&
      (this.exclusiveMax === undefined || value < this.exclusiveMax) &&
      (this.multipleOf === undefined || this.isMultiple(value))
    );
  }
}

function Float(options) {
  return new FloatType(options);
}

function float(min, max, isMandatory = true, isNullable = false) {
  if (min !== undefined && min !== null && typeof min === 'object') {
    return new FloatType(min);
  }
  return new FloatType({ min, max, isMandatory, isNullable });
}

function ofloat(min, max, isMandatory = false, isNullable = false) {
  if (min !== undefined && min !== null && typeof min === 'object') {
    return new FloatType({ isMandatory: false, ...min });
  }
  return new FloatType({ min, max, isMandatory, isNullable });
}

module.exports = {
  FloatType,
  Float,
  float,
  ofloat,
  num: float,
  onum: ofloat,
};
