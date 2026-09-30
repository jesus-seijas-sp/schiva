const { hasFewerCodePoints, hasMoreCodePoints } = require('./code-point-length');
const { ValidateType } = require('./validate-type');
const { FORMATS, matchesFormat } = require('../formats');

// The limits of a format: how a comparison fails them (a comparison that is undefined never does), the text of their
// error, and their comparison in ajv's params.
const FORMAT_LIMITS = {
  formatMinimum: { fails: (result) => result < 0, text: 'at least', comparison: '>=' },
  formatMaximum: { fails: (result) => result > 0, text: 'at most', comparison: '<=' },
  formatExclusiveMinimum: { fails: (result) => result <= 0, text: 'greater than', comparison: '>' },
  formatExclusiveMaximum: { fails: (result) => result >= 0, text: 'less than', comparison: '<' },
};

class StringType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.min = options.min;
    this.max = options.max;
    this.pattern = options.pattern;
    this.allowEmpty = options.allowEmpty;
    // Count min/max in Unicode code points (as JSON Schema does) instead of UTF-16 units.
    this.countCodePoints = options.countCodePoints;
    // A format the string must have: the name of a built-in one (formats.js), or with `formatCheck` (a function or a
    // regular expression) one of the JSON Schema option "formats".
    this.format = options.format;
    this.formatCheck = options.formatCheck;
    if (this.format !== undefined && this.formatCheck === undefined) {
      if (!Object.prototype.hasOwnProperty.call(FORMATS, this.format)) {
        throw new Error(`Unknown String format "${this.format}": use one of ${Object.keys(FORMATS).join(', ')}`);
      }
      this.formatCheck = FORMATS[this.format];
    }
    // [{ keyword, limit, compare }]: limits of the value of the format (formatMinimum, formatMaximum,
    // formatExclusiveMinimum and formatExclusiveMaximum), checked with compare(value, limit) after the format.
    this.formatLimits = options.formatLimits || [];
  }

  // The first limit of the format the value does not satisfy, or undefined.
  failedLimit(value) {
    return this.formatLimits.find(({ keyword, limit, compare }) => FORMAT_LIMITS[keyword].fails(compare(value, limit)));
  }

  hasFormat(value) {
    return this.formatCheck === undefined || matchesFormat(this.formatCheck, value);
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
      if (!this.hasFormat(value)) {
        return `${fieldName} must be a valid ${this.format}`;
      }
      const failed = this.failedLimit(value);
      if (failed) {
        return `${fieldName} must be ${FORMAT_LIMITS[failed.keyword].text} ${failed.limit}`;
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
      (!this.pattern || this.pattern.test(value)) &&
      this.hasFormat(value) &&
      this.failedLimit(value) === undefined
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
  FORMAT_LIMITS,
  StringType,
  String,
  str,
  ostr,
};
