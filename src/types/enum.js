const { StringType } = require('./string');

class EnumType extends StringType {
  constructor(options = {}) {
    super(options);
    this.options = options.options;
  }

  validate(value, fieldName = 'Value') {
    const result = super.validate(value, fieldName);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null) {
      if (!this.options.includes(value)) {
        return `${fieldName} must be one of: ${this.options.join(', ')}`;
      }
    }
    return undefined;
  }

  isValid(value) {
    return super.isValid(value) && (value === undefined || value === null || this.options.includes(value));
  }
}

function Enum(options) {
  return new EnumType(options);
}

function enumt(options, isMandatory = true, isNullable = false) {
  if (options !== undefined && options !== null && !Array.isArray(options) && typeof options === 'object') {
    return new EnumType(options);
  }
  return new EnumType({ options, isMandatory, isNullable });
}

function oenumt(options, isMandatory = false, isNullable = false) {
  if (options !== undefined && options !== null && !Array.isArray(options) && typeof options === 'object') {
    return new EnumType({ isMandatory: false, ...options });
  }
  return new EnumType({ options, isMandatory, isNullable });
}

module.exports = {
  EnumType,
  Enum,
  enumt,
  oenumt,
  oenum: oenumt,
};
