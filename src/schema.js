const { ObjType, ValidateType } = require('./types');

// Declared keys are read as own properties only: {}.toString or {}.constructor must not count as present.
// A value read from a plain object is its own unless Object.prototype has the key, which avoids the slower
// own-property check in the common case. The prototype is read with __proto__ rather than Object.getPrototypeOf(),
// which makes V8 deoptimize the code around it (twice slower). Objects without that accessor (no prototype, or an
// own "__proto__" key from JSON.parse) are not taken as plain and get the own-property check.
function ownValue(obj, key) {
  const value = obj[key];
  // eslint-disable-next-line no-proto -- see above
  if (value === undefined || (obj.__proto__ === Object.prototype && !(key in Object.prototype))) {
    return value;
  }
  return Object.prototype.hasOwnProperty.call(obj, key) ? value : undefined;
}

class Schema {
  constructor(schema = {}, options = {}) {
    this.schema = schema;
    this.options = options;
    this.isOpen = options.isOpen === undefined ? true : options.isOpen;
    this.isMandatory = options.isMandatory === undefined ? true : options.isMandatory;
    this.isNullable = options.isNullable === undefined ? false : options.isNullable;
    // Type that keys not declared in the schema must satisfy (only used when the schema is open).
    this.additionalType = options.additionalType;
    // [{ pattern, type }]: keys matching a pattern must satisfy its type, and are not checked by additionalType.
    this.patternTypes = options.patternTypes || [];
    this.minProperties = options.minProperties;
    this.maxProperties = options.maxProperties;
    // [{ key, required: [properties] } or { key, type }]: when key is present, the properties must be present too,
    // or the whole object must satisfy type.
    this.dependencies = options.dependencies || [];
    // Type every key must satisfy, reported as "Key <name>".
    this.propertyNameType = options.propertyNameType;
    this.visitObjs();
    this.keys = Object.keys(this.schema);
    this.keySet = new Set(this.keys);
  }

  visitObjs() {
    // Nested schemas share the options, except the ones about the keys of this object.
    const options = { ...this.options, patternTypes: undefined, dependencies: undefined, propertyNameType: undefined };
    const keys = Object.keys(this.schema);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const value = this.schema[key];
      if (!(value instanceof Schema)) {
        if (!(value instanceof ValidateType)) {
          const obj = new ObjType({ schema: value });
          this.schema[key] = new Schema(obj.schema, options);
        } else if (value instanceof ObjType) {
          this.schema[key] = new Schema(value.schema, options);
        }
      }
    }
  }

  // Fast boolean check equivalent to validate(obj).length === 0 that builds no messages.
  isValid(obj) {
    if (obj === undefined) {
      return !this.isMandatory;
    }
    if (obj === null) {
      return this.isNullable;
    }
    if (typeof obj !== 'object' || Array.isArray(obj)) {
      return false;
    }
    const { keys, keySet } = this;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (!this.schema[key].isValid(ownValue(obj, key))) {
        return false;
      }
    }
    const objKeys = Object.keys(obj);
    if (
      (this.minProperties !== undefined && objKeys.length < this.minProperties) ||
      (this.maxProperties !== undefined && objKeys.length > this.maxProperties)
    ) {
      return false;
    }
    const { patternTypes, propertyNameType } = this;
    if (!this.isOpen || this.additionalType || patternTypes.length > 0 || propertyNameType) {
      for (let i = 0; i < objKeys.length; i += 1) {
        const key = objKeys[i];
        if (propertyNameType && !propertyNameType.isValid(key)) {
          return false;
        }
        let matched = false;
        for (let j = 0; j < patternTypes.length; j += 1) {
          if (patternTypes[j].pattern.test(key)) {
            matched = true;
            if (!patternTypes[j].type.isValid(obj[key])) {
              return false;
            }
          }
        }
        if (!keySet.has(key) && !matched) {
          if (!this.isOpen || (this.additionalType && !this.additionalType.isValid(obj[key]))) {
            return false;
          }
        }
      }
    }
    return this.dependencies.every(
      ({ key, required, type }) =>
        ownValue(obj, key) === undefined ||
        (required ? required.every((property) => ownValue(obj, property) !== undefined) : type.isValid(obj))
    );
  }

  validate(obj, fieldName = undefined) {
    return this.isValid(obj) ? [] : this.errors(obj, fieldName);
  }

  // Compiles the schema into generated code, several times faster than validate(): see compileType() in compile.js
  // for the options. The compiled function does not see changes made to the schema afterwards.
  compile(options = {}) {
    // eslint-disable-next-line global-require -- compile.js requires this module
    return require('./compile').compileType(this, options);
  }

  // Error messages of a value already known to be invalid.
  errors(obj, fieldName = undefined) {
    const name = fieldName || 'Value';
    const { keys: schemaKeys, keySet } = this;
    const errors = [];
    if (obj === undefined) {
      if (this.isMandatory) {
        errors.push(`${name} is mandatory`);
      }
      return errors;
    }
    if (obj === null) {
      if (!this.isNullable) {
        errors.push(`${name} cannot be null`);
      }
      return errors;
    }
    if (typeof obj !== 'object' || Array.isArray(obj)) {
      errors.push(`${name} must be an object`);
      return errors;
    }
    for (let i = 0; i < schemaKeys.length; i += 1) {
      const key = schemaKeys[i];
      const type = this.schema[key];
      const value = ownValue(obj, key);
      if (!type.isValid(value)) {
        errors.push(type.errors(value, fieldName ? `${fieldName}.${key}` : key));
      }
    }
    const objKeys = Object.keys(obj);
    for (let i = 0; i < objKeys.length; i += 1) {
      const key = objKeys[i];
      const keyName = fieldName ? `${fieldName}.${key}` : key;
      if (this.propertyNameType && !this.propertyNameType.isValid(key)) {
        errors.push(this.propertyNameType.errors(key, `Key ${keyName}`));
      }
      let matched = false;
      this.patternTypes.forEach(({ pattern, type }) => {
        if (pattern.test(key)) {
          matched = true;
          if (!type.isValid(obj[key])) {
            errors.push(type.errors(obj[key], keyName));
          }
        }
      });
      if (!keySet.has(key) && !matched) {
        if (!this.isOpen) {
          errors.push(`Unexpected key: ${keyName}`);
        } else if (this.additionalType && !this.additionalType.isValid(obj[key])) {
          errors.push(this.additionalType.errors(obj[key], keyName));
        }
      }
    }
    if (this.minProperties !== undefined && objKeys.length < this.minProperties) {
      errors.push(`${name} must have at least ${this.minProperties} properties`);
    }
    if (this.maxProperties !== undefined && objKeys.length > this.maxProperties) {
      errors.push(`${name} must have at most ${this.maxProperties} properties`);
    }
    this.dependencies.forEach(({ key, required, type }) => {
      if (ownValue(obj, key) === undefined) {
        return;
      }
      const keyName = fieldName ? `${fieldName}.${key}` : key;
      if (required) {
        required
          .filter((property) => ownValue(obj, property) === undefined)
          .forEach((property) => {
            const propertyName = fieldName ? `${fieldName}.${property}` : property;
            errors.push(`${propertyName} is mandatory when ${keyName} is present`);
          });
      } else if (!type.isValid(obj)) {
        errors.push(type.errors(obj, fieldName));
      }
    });
    return errors.flat(Infinity);
  }

  mandatory(isMandatory = true) {
    this.isMandatory = isMandatory;
    return this;
  }

  nullable(isNullable = true) {
    this.isNullable = isNullable;
    return this;
  }

  optional() {
    this.isMandatory = false;
    return this;
  }

  required() {
    this.isMandatory = true;
    return this;
  }

  notNull() {
    this.isNullable = false;
    return this;
  }
}

module.exports = {
  Schema,
};
