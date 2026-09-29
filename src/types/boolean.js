const { ValidateType } = require('./validate-type');

class BooleanType extends ValidateType {
  validate(value, fieldName = 'Value') {
    const result = super.validate(value, fieldName);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      return `${fieldName} must be a boolean`;
    }
    return undefined;
  }

  isValid(value) {
    return this.checkPresence(value) ?? typeof value === 'boolean';
  }
}

function Boolean(options) {
  return new BooleanType(options);
}

function bool(isMandatory = true, isNullable = false) {
  if (isMandatory !== undefined && isMandatory !== null && typeof isMandatory === 'object') {
    return new BooleanType(isMandatory);
  }
  return new BooleanType({ isMandatory, isNullable });
}

function obool(isMandatory = false, isNullable = false) {
  if (isMandatory !== undefined && isMandatory !== null && typeof isMandatory === 'object') {
    return new BooleanType({ isMandatory: false, ...isMandatory });
  }
  return new BooleanType({ isMandatory, isNullable });
}

module.exports = {
  BooleanType,
  Boolean,
  bool,
  obool,
};
