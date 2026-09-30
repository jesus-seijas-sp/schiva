const { hasDuplicates } = require('./has-duplicates');
const { assignDefaults } = require('../defaults');
const { readCoerced } = require('../coerce');
const { ValidateType, isPlainObject, toType, toTypes } = require('./validate-type');

class ArrayOfType extends ValidateType {
  constructor(options = {}) {
    super(options);
    // A type for every element, or an array of types for the elements at each position (a tuple).
    this.type = Array.isArray(options.type)
      ? toTypes(options.type, 'ArrayOf type')
      : toType(options.type, 'ArrayOf type');
    this.min = options.min;
    this.max = options.max;
    // [{ key, value, empty }]: defaults assigned to missing positions of a tuple before checking it (useDefaults).
    this.defaults = options.defaults || [];
    this.unique = options.unique;
    // At least one element must satisfy it, or between minContains (default 1) and maxContains elements.
    this.contains = toType(options.contains, 'ArrayOf contains');
    this.minContains = options.minContains;
    this.maxContains = options.maxContains;
    // With a tuple, the elements after its last position must satisfy it.
    this.additionalType = toType(options.additionalType, 'ArrayOf additionalType');
  }

  // Number of elements matching contains, counted only as far as the limits need.
  countMatches(value) {
    const min = this.minContains === undefined ? 1 : this.minContains;
    const stop = this.maxContains === undefined ? min : this.maxContains + 1;
    let count = 0;
    for (let i = 0; i < value.length && count < stop; i += 1) {
      if (this.contains.isValid(value[i])) {
        count += 1;
      }
    }
    return count;
  }

  hasMatches(value) {
    const count = this.countMatches(value);
    const min = this.minContains === undefined ? 1 : this.minContains;
    return count >= min && (this.maxContains === undefined || count <= this.maxContains);
  }

  // Error of the elements matching contains, or undefined.
  containsError(value, fieldName) {
    const min = this.minContains === undefined ? 1 : this.minContains;
    const max = this.maxContains;
    const count = this.countMatches(value);
    if (count < min) {
      return min === 1
        ? `${fieldName} must contain at least one matching element`
        : `${fieldName} must contain at least ${min} matching elements`;
    }
    if (max !== undefined && count > max) {
      return max === 1
        ? `${fieldName} must contain at most one matching element`
        : `${fieldName} must contain at most ${max} matching elements`;
    }
    return undefined;
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
      if (this.defaults.length > 0) {
        assignDefaults(value, this.defaults);
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
      const containsError = this.contains && this.containsError(value, fieldName);
      if (containsError) {
        return containsError;
      }
      if (this.type) {
        const errors = [];
        const check = (type, i) => {
          // With coerceTypes, an element is converted to the types of its schema as it is read (see coerce.js).
          const item = readCoerced(value, i, type, value[i]);
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
    if (Array.isArray(value) && this.defaults.length > 0) {
      assignDefaults(value, this.defaults);
    }
    if (
      !Array.isArray(value) ||
      (this.min !== undefined && value.length < this.min) ||
      (this.max !== undefined && value.length > this.max) ||
      (this.unique && hasDuplicates(value)) ||
      (this.contains && !this.hasMatches(value))
    ) {
      return false;
    }
    if (Array.isArray(this.type)) {
      for (let i = 0; i < this.type.length; i += 1) {
        if (!this.type[i].isValid(readCoerced(value, i, this.type[i], value[i]))) {
          return false;
        }
      }
      if (this.additionalType) {
        for (let i = this.type.length; i < value.length; i += 1) {
          if (!this.additionalType.isValid(readCoerced(value, i, this.additionalType, value[i]))) {
            return false;
          }
        }
      }
    } else if (this.type) {
      for (let i = 0; i < value.length; i += 1) {
        if (!this.type.isValid(readCoerced(value, i, this.type, value[i]))) {
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

const OPTION_KEYS = [
  'type',
  'min',
  'max',
  'unique',
  'contains',
  'minContains',
  'maxContains',
  'additionalType',
  'isMandatory',
  'isNullable',
];

// The first argument of arrOf() is the options when it is a plain object that is empty or has an option key;
// otherwise it is the type of the elements (a type, a schema, or a plain object of types).
function isOptions(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === 0 || keys.some((key) => OPTION_KEYS.includes(key));
}

function arrOf(type, min, max, isMandatory = true, isNullable = false) {
  if (isOptions(type)) {
    return new ArrayOfType(type);
  }
  return new ArrayOfType({ type, min, max, isMandatory, isNullable });
}

function oarrOf(type, min, max, isMandatory = false, isNullable = false) {
  if (isOptions(type)) {
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
