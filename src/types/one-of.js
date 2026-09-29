const { ValidateType, toTypes } = require('./validate-type');

// Value must satisfy exactly one of the types. When none does, reports the errors of every type, like AnyOfType.
class OneOfType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.types = toTypes(options.types, 'OneOf types') || [];
  }

  // Number of types the value satisfies, counting up to 2.
  countMatches(value) {
    let matches = 0;
    for (let i = 0; i < this.types.length && matches < 2; i += 1) {
      if (this.types[i].isValid(value)) {
        matches += 1;
      }
    }
    return matches;
  }

  validate(value, fieldName = 'Value') {
    const result = super.validate(value, fieldName);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null) {
      const matches = this.countMatches(value);
      if (this.types.length === 0) {
        return `${fieldName} must match exactly one schema, but matches none`;
      }
      if (matches === 0) {
        return this.types.map((type) => type.errors(value, fieldName));
      }
      if (matches > 1) {
        return `${fieldName} must match exactly one schema, but matches more than one`;
      }
    }
    return undefined;
  }

  isValid(value) {
    return this.checkPresence(value) ?? this.countMatches(value) === 1;
  }
}

function OneOf(options) {
  return new OneOfType(options);
}

function oneOf(types, isMandatory = true, isNullable = false) {
  if (types !== undefined && types !== null && !Array.isArray(types) && typeof types === 'object') {
    return new OneOfType(types);
  }
  return new OneOfType({ types, isMandatory, isNullable });
}

function ooneOf(types, isMandatory = false, isNullable = false) {
  if (types !== undefined && types !== null && !Array.isArray(types) && typeof types === 'object') {
    return new OneOfType({ isMandatory: false, ...types });
  }
  return new OneOfType({ types, isMandatory, isNullable });
}

module.exports = {
  OneOfType,
  OneOf,
  oneOf,
  ooneOf,
};
