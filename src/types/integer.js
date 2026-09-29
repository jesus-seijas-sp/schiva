const { FloatType } = require('./float');

class IntegerType extends FloatType {
  validate(value, fieldName = 'Value') {
    const result = super.validate(value, fieldName);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null) {
      if (!Number.isInteger(value)) {
        return `${fieldName} must be an integer`;
      }
    }
    return undefined;
  }

  isValid(value) {
    return super.isValid(value) && (value === undefined || value === null || Number.isInteger(value));
  }
}

function Integer(options) {
  return new IntegerType(options);
}

function int(min, max, isMandatory = true, isNullable = false) {
  if (min !== undefined && min !== null && typeof min === 'object') {
    return new IntegerType(min);
  }
  return new IntegerType({ min, max, isMandatory, isNullable });
}

function oint(min, max, isMandatory = false, isNullable = false) {
  if (min !== undefined && min !== null && typeof min === 'object') {
    return new IntegerType({ isMandatory: false, ...min });
  }
  return new IntegerType({ min, max, isMandatory, isNullable });
}

module.exports = {
  IntegerType,
  Integer,
  int,
  oint,
};
