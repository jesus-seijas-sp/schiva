const { deepEqual } = require('../deep-equal');
const { ValidateType } = require('./validate-type');

function formatValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// Value must be deep-equal to one of the given values, whatever their type.
class ValuesType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.values = options.values || [];
  }

  validate(value, fieldName = 'Value') {
    const result = super.validate(value, fieldName);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null && !this.values.some((item) => deepEqual(item, value))) {
      if (this.values.length === 1) {
        return `${fieldName} must be equal to ${formatValue(this.values[0])}`;
      }
      return `${fieldName} must be one of: ${this.values.map(formatValue).join(', ')}`;
    }
    return undefined;
  }

  isValid(value) {
    return this.checkPresence(value) ?? this.values.some((item) => deepEqual(item, value));
  }
}

function Values(options) {
  return new ValuesType(options);
}

function Const(value, options = {}) {
  return new ValuesType({ ...options, values: [value] });
}

module.exports = {
  ValuesType,
  Values,
  Const,
};
