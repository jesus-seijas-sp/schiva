const { ValidateType, toType } = require('./validate-type');

// Value must not satisfy `type`.
class NotType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.type = toType(options.type, 'Not type');
  }

  validate(value, fieldName = 'Value') {
    const result = super.validate(value, fieldName);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null && this.type.isValid(value)) {
      return `${fieldName} must not match the excluded schema`;
    }
    return undefined;
  }

  isValid(value) {
    return this.checkPresence(value) ?? !this.type.isValid(value);
  }
}

function Not(options) {
  return new NotType(options);
}

function not(type, isMandatory = true, isNullable = false) {
  if (type !== undefined && type !== null && !(type instanceof ValidateType) && typeof type === 'object') {
    return new NotType(type);
  }
  return new NotType({ type, isMandatory, isNullable });
}

function onot(type, isMandatory = false, isNullable = false) {
  if (type !== undefined && type !== null && !(type instanceof ValidateType) && typeof type === 'object') {
    return new NotType({ isMandatory: false, ...type });
  }
  return new NotType({ type, isMandatory, isNullable });
}

module.exports = {
  NotType,
  Not,
  not,
  onot,
};
