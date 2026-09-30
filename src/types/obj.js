const { ValidateType, toType } = require('./validate-type');

class ObjType extends ValidateType {
  constructor(options = {}) {
    super(options);
    // The shape as given, which a Schema around it turns into a nested schema with its options (see visitObjs()), and
    // the type it stands for: a plain object of types is a Schema.
    this.shape = options.schema;
    this.schema = toType(options.schema, 'Obj schema');
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

const OPTION_KEYS = ['schema', 'isMandatory', 'isNullable'];

// The first argument of obj() is the options when it is a plain object that is empty or has an option key; otherwise
// it is the shape of the object (a plain object of types), like arrOf().
const isOptions = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof ValidateType) &&
  (Object.keys(value).length === 0 || Object.keys(value).some((key) => OPTION_KEYS.includes(key)));

function obj(schema, isMandatory = true, isNullable = false) {
  if (isOptions(schema)) {
    return new ObjType(schema);
  }
  return new ObjType({ schema, isMandatory, isNullable });
}

function oobj(schema, isMandatory = false, isNullable = false) {
  if (isOptions(schema)) {
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
