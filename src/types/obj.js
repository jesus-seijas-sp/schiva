const { ValidateType } = require('./validate-type');

class ObjType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.schema = options.schema;
  }

  // The field name goes to the schema as received (see AllOfType.validate()).
  validate(value, fieldName = undefined) {
    const name = fieldName || 'Value';
    const result = super.validate(value, name);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null) {
      if (typeof value !== 'object' || Array.isArray(value)) {
        return `${name} must be an object`;
      }
      if (this.schema) return this.schema.validate(value, fieldName);
    }
    return undefined;
  }

  isValid(value) {
    const presence = this.checkPresence(value);
    if (presence !== undefined) {
      return presence;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    return !this.schema || this.schema.isValid(value);
  }
}

function Obj(options) {
  return new ObjType(options);
}

function obj(schema, isMandatory = true, isNullable = false) {
  if (schema !== undefined && schema !== null && !Array.isArray(schema) && typeof schema === 'object') {
    return new ObjType(schema);
  }
  return new ObjType({ schema, isMandatory, isNullable });
}

function oobj(schema, isMandatory = false, isNullable = false) {
  if (schema !== undefined && schema !== null && !Array.isArray(schema) && typeof schema === 'object') {
    return new ObjType({ isMandatory: false, ...schema });
  }
  return new ObjType({ schema, isMandatory, isNullable });
}

module.exports = {
  ObjType,
  Obj,
  obj,
  oobj,
};
