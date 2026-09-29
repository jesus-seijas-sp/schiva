const { hasDuplicates } = require('./has-duplicates');
const { ValidateType } = require('./validate-type');

class ArrayOfType extends ValidateType {
  constructor(options = {}) {
    super(options);
    // A type for every element, or an array of types for the elements at each position (a tuple).
    this.type = options.type;
    this.min = options.min;
    this.max = options.max;
    this.unique = options.unique;
    // At least one element must satisfy it.
    this.contains = options.contains;
    // With a tuple, the elements after its last position must satisfy it.
    this.additionalType = options.additionalType;
  }

  hasMatch(value) {
    for (let i = 0; i < value.length; i += 1) {
      if (this.contains.isValid(value[i])) {
        return true;
      }
    }
    return false;
  }

  validate(value, fieldName = 'Value') {
    const result = super.validate(value, fieldName);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null) {
      if (!Array.isArray(value)) {
        return `${fieldName} must be an array`;
      }
      if (this.min !== undefined && value.length < this.min) {
        return `${fieldName} must have at least ${this.min} elements`;
      }
      if (this.max !== undefined && value.length > this.max) {
        return `${fieldName} must have at most ${this.max} elements`;
      }
      if (this.unique && hasDuplicates(value)) {
        return `${fieldName} must not have duplicate elements`;
      }
      if (this.contains && !this.hasMatch(value)) {
        return `${fieldName} must contain at least one matching element`;
      }
      if (this.type) {
        const errors = [];
        const check = (type, i) => {
          const item = value[i];
          if (!type.isValid(item)) {
            errors.push(type.errors(item, `${fieldName}[${i}]`));
          }
        };
        if (Array.isArray(this.type)) {
          for (let i = 0; i < this.type.length; i += 1) {
            check(this.type[i], i);
          }
          if (this.additionalType) {
            for (let i = this.type.length; i < value.length; i += 1) {
              check(this.additionalType, i);
            }
          }
        } else {
          for (let i = 0; i < value.length; i += 1) {
            check(this.type, i);
          }
        }
        return errors.flat();
      }
    }
    return undefined;
  }

  isValid(value) {
    const presence = this.checkPresence(value);
    if (presence !== undefined) {
      return presence;
    }
    if (
      !Array.isArray(value) ||
      (this.min !== undefined && value.length < this.min) ||
      (this.max !== undefined && value.length > this.max) ||
      (this.unique && hasDuplicates(value)) ||
      (this.contains && !this.hasMatch(value))
    ) {
      return false;
    }
    if (Array.isArray(this.type)) {
      for (let i = 0; i < this.type.length; i += 1) {
        if (!this.type[i].isValid(value[i])) {
          return false;
        }
      }
      if (this.additionalType) {
        for (let i = this.type.length; i < value.length; i += 1) {
          if (!this.additionalType.isValid(value[i])) {
            return false;
          }
        }
      }
    } else if (this.type) {
      for (let i = 0; i < value.length; i += 1) {
        if (!this.type.isValid(value[i])) {
          return false;
        }
      }
    }
    return true;
  }
}

function ArrayOf(options) {
  return new ArrayOfType(options);
}

function arrOf(type, min, max, isMandatory = true, isNullable = false) {
  if (type !== undefined && type !== null && typeof type === 'object') {
    return new ArrayOfType(type);
  }
  return new ArrayOfType({ type, min, max, isMandatory, isNullable });
}

function oarrOf(type, min, max, isMandatory = false, isNullable = false) {
  if (type !== undefined && type !== null && typeof type === 'object') {
    return new ArrayOfType({ isMandatory: false, ...type });
  }
  return new ArrayOfType({ type, min, max, isMandatory, isNullable });
}

module.exports = {
  ArrayOfType,
  ArrayOf,
  arrOf,
  oarrOf,
};
