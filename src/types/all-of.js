const { ValidateType, toTypes } = require('./validate-type');

// Value must satisfy every type; reports the errors of the first type that fails.
class AllOfType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.types = toTypes(options.types, 'AllOf types') || [];
  }

  // The errors of every type the value fails. The field name goes to them as received: undefined for the value
  // itself, so a Schema names its keys as it does on its own.
  validate(value, fieldName = undefined) {
    const result = super.validate(value, fieldName || 'Value');
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null) {
      const errors = this.types.filter((type) => !type.isValid(value)).map((type) => type.errors(value, fieldName));
      if (errors.length <= 1) {
        return errors[0];
      }
      return errors.flat(Infinity);
    }
    return undefined;
  }

  isValid(value) {
    const presence = this.checkPresence(value);
    if (presence !== undefined) {
      return presence;
    }
    for (let i = 0; i < this.types.length; i += 1) {
      if (!this.types[i].isValid(value)) {
        return false;
      }
    }
    return true;
  }
}

function AllOf(options) {
  return new AllOfType(options);
}

function allOf(types, isMandatory = true, isNullable = false) {
  if (types !== undefined && types !== null && !Array.isArray(types) && typeof types === 'object') {
    return new AllOfType(types);
  }
  return new AllOfType({ types, isMandatory, isNullable });
}

function oallOf(types, isMandatory = false, isNullable = false) {
  if (types !== undefined && types !== null && !Array.isArray(types) && typeof types === 'object') {
    return new AllOfType({ isMandatory: false, ...types });
  }
  return new AllOfType({ types, isMandatory, isNullable });
}

module.exports = {
  AllOfType,
  AllOf,
  allOf,
  oallOf,
};
