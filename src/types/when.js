const { ValidateType, toType } = require('./validate-type');

const JSON_TYPES = ['object', 'array', 'string', 'number'];

function isJsonType(value, jsonType) {
  switch (jsonType) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    default:
      return typeof value === 'number';
  }
}

// Checks the value with `type` only when it has the given JSON type (object, array, string or number); values of
// other types are valid. This is how JSON Schema applies keywords such as minimum or properties when no "type" is
// declared. The field name is passed through unchanged, so the wrapper does not show in messages.
class WhenType extends ValidateType {
  constructor(options = {}) {
    super(options);
    if (!JSON_TYPES.includes(options.jsonType)) {
      throw new Error(`WhenType jsonType must be one of: ${JSON_TYPES.join(', ')}`);
    }
    this.jsonType = options.jsonType;
    this.type = toType(options.type, 'When type');
  }

  validate(value, fieldName) {
    const result = super.validate(value, fieldName);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null && isJsonType(value, this.jsonType)) {
      return this.type.validate(value, fieldName);
    }
    return undefined;
  }

  errors(value, fieldName) {
    return this.validate(value, fieldName);
  }

  isValid(value) {
    const presence = this.checkPresence(value);
    if (presence !== undefined) {
      return presence;
    }
    return !isJsonType(value, this.jsonType) || this.type.isValid(value);
  }
}

function When(options) {
  return new WhenType(options);
}

module.exports = {
  WhenType,
  When,
  isJsonType,
};
