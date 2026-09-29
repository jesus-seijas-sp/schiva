const { ValidateType } = require('./validate-type');

// No value is valid, like the JSON Schema false: only undefined (when not mandatory) and null (when nullable) pass.
class NeverType extends ValidateType {
  validate(value, fieldName = 'Value') {
    const result = super.validate(value, fieldName);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null) {
      return `${fieldName} is not allowed`;
    }
    return undefined;
  }

  isValid(value) {
    return this.checkPresence(value) ?? false;
  }
}

function Never(options) {
  return new NeverType(options);
}

function never(isMandatory = false, isNullable = false) {
  if (isMandatory !== undefined && isMandatory !== null && typeof isMandatory === 'object') {
    return new NeverType({ isMandatory: false, ...isMandatory });
  }
  return new NeverType({ isMandatory, isNullable });
}

module.exports = {
  NeverType,
  Never,
  never,
};
