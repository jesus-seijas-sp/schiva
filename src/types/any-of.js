const { ValidateType, toTypes } = require('./validate-type');

class AnyOfType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.types = toTypes(options.types, 'AnyOf types');
  }

  // The field name goes to the alternatives as received (see AllOfType.validate()).
  validate(value, fieldName = undefined) {
    const result = super.validate(value, fieldName || 'Value');
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null) {
      if (this.isValid(value)) {
        return undefined;
      }
      return this.types.map((type) => type.errors(value, fieldName));
    }
    return undefined;
  }

  isValid(value) {
    const presence = this.checkPresence(value);
    if (presence !== undefined) {
      return presence;
    }
    if (!this.types || this.types.length === 0) {
      return true;
    }
    for (let i = 0; i < this.types.length; i += 1) {
      if (this.types[i].isValid(value)) {
        return true;
      }
    }
    return false;
  }
}

function AnyOf(options) {
  return new AnyOfType(options);
}

function anyOf(types, isMandatory = true, isNullable = false) {
  if (types !== undefined && types !== null && !Array.isArray(types) && typeof types === 'object') {
    return new AnyOfType(types);
  }
  return new AnyOfType({ types, isMandatory, isNullable });
}

function oanyOf(types, isMandatory = false, isNullable = false) {
  if (types !== undefined && types !== null && !Array.isArray(types) && typeof types === 'object') {
    return new AnyOfType({ isMandatory: false, ...types });
  }
  return new AnyOfType({ types, isMandatory, isNullable });
}

module.exports = {
  AnyOfType,
  AnyOf,
  anyOf,
  oanyOf,
};
