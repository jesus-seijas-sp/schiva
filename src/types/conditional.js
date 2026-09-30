const { ValidateType, toType } = require('./validate-type');

// When the value satisfies `ifType` it must satisfy `thenType`, otherwise `elseType`; a missing branch accepts
// anything. Only the errors of the branch are reported, like JSON Schema if/then/else.
class ConditionalType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.ifType = toType(options.ifType, 'Conditional ifType');
    this.thenType = toType(options.thenType, 'Conditional thenType');
    this.elseType = toType(options.elseType, 'Conditional elseType');
  }

  branch(value) {
    return this.ifType.isValid(value) ? this.thenType : this.elseType;
  }

  // The field name goes to the branch as received (see AllOfType.validate()).
  validate(value, fieldName = undefined) {
    const result = super.validate(value, fieldName || 'Value');
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null) {
      const branch = this.branch(value);
      if (branch && !branch.isValid(value)) {
        return branch.errors(value, fieldName);
      }
    }
    return undefined;
  }

  isValid(value) {
    const presence = this.checkPresence(value);
    if (presence !== undefined) {
      return presence;
    }
    const branch = this.branch(value);
    return !branch || branch.isValid(value);
  }
}

function Conditional(options) {
  return new ConditionalType(options);
}

module.exports = {
  ConditionalType,
  Conditional,
};
