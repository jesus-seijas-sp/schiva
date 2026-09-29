const { ValidateType, toType } = require('./validate-type');

// Validates with the type it refers to, which is set once references are resolved; recursive schemas refer back to a
// type that contains the reference. Only undefined is handled here (isMandatory); null and other values go to the
// target. The field name is passed through unchanged, so the reference does not show in messages.
class RefType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.ref = options.ref;
    this.target = toType(options.target, 'Ref target');
  }

  getTarget() {
    if (!this.target) {
      throw new Error(`Reference "${this.ref}" is not resolved`);
    }
    return this.target;
  }

  validate(value, fieldName) {
    if (value === undefined) {
      return super.validate(value, fieldName);
    }
    return this.getTarget().validate(value, fieldName);
  }

  errors(value, fieldName) {
    if (value === undefined) {
      return super.validate(value, fieldName);
    }
    return this.getTarget().errors(value, fieldName);
  }

  isValid(value) {
    if (value === undefined) {
      return !this.isMandatory;
    }
    return this.getTarget().isValid(value);
  }
}

function Ref(options) {
  return new RefType(options);
}

module.exports = {
  RefType,
  Ref,
};
