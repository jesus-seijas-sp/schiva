const { ValidateType } = require('./validate-type');

class AnyType extends ValidateType {
  isValid(value) {
    return this.checkPresence(value) ?? true;
  }
}

function Any(options) {
  return new AnyType(options);
}

function any(isMandatory = true, isNullable = false) {
  if (isMandatory !== undefined && isMandatory !== null && typeof isMandatory === 'object') {
    return new AnyType(isMandatory);
  }
  return new AnyType({ isMandatory, isNullable });
}

function oany(isMandatory = false, isNullable = false) {
  if (isMandatory !== undefined && isMandatory !== null && typeof isMandatory === 'object') {
    return new AnyType({ isMandatory: false, ...isMandatory });
  }
  return new AnyType({ isMandatory, isNullable });
}

module.exports = {
  AnyType,
  Any,
  any,
  oany,
};
