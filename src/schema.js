const { ObjType, ValidateType, toType } = require('./types');
const { assignDefaults } = require('./defaults');
const { readCoerced } = require('./coerce');

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
    this.additionalType = toType(options.additionalType, 'Schema additionalType');
    // [{ pattern, type }]: keys matching a pattern must satisfy its type, and are not checked by additionalType.
    this.patternTypes = (options.patternTypes || []).map((item, i) => ({
      ...item,
      type: toType(item.type, `Schema patternTypes[${i}].type`),
    }));
    this.minProperties = options.minProperties;
    this.maxProperties = options.maxProperties;
    // [{ key, value, empty }]: defaults assigned to missing properties before checking them (option useDefaults).
    this.defaults = options.defaults || [];
    // What to do with additional properties (option removeAdditional): 'delete' them, delete the 'failing' ones, or
    // nothing. They are deleted where they are checked, in the same order as the compiled code.
    this.removeAdditional = options.removeAdditional;
    // [{ key, required: [properties] } or { key, type }]: when key is present, the properties must be present too,
    // or the whole object must satisfy type.
    this.dependencies = (options.dependencies || []).map((item, i) =>
      item.type === undefined ? item : { ...item, type: toType(item.type, `Schema dependencies[${i}].type`) }
    );
    // Type every key must satisfy, reported as "Key <name>".
    this.propertyNameType = toType(options.propertyNameType, 'Schema propertyNameType');
    this.visitObjs();
    this.keys = Object.keys(this.schema);
    this.keySet = new Set(this.keys);
  }

  visitObjs() {
    // Nested schemas share the options, except the ones about the keys of this object.
    const options = {
      ...this.options,
      patternTypes: undefined,
      dependencies: undefined,
      propertyNameType: undefined,
      defaults: undefined,
      removeAdditional: undefined,
    };
    const keys = Object.keys(this.schema);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const value = this.schema[key];
      if (!(value instanceof Schema)) {
        if (!(value instanceof ValidateType)) {
          this.schema[key] = new Schema(value, options);
        } else if (
          value instanceof ObjType &&
          !(value.schema instanceof ValidateType && !(value.schema instanceof Schema))
        ) {
          this.schema[key] = new Schema(value.shape instanceof Schema ? value.shape.schema : value.shape, options);
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
    if (this.defaults.length > 0) {
      assignDefaults(obj, this.defaults);
    }
    const { keys } = this;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      // With coerceTypes, a value is converted to the types of its schema as it is read (see coerce.js).
      if (!this.schema[key].isValid(readCoerced(obj, key, this.schema[key], ownValue(obj, key)))) {
        return false;
      }
    }
    const objKeys = Object.keys(obj);
    const { patternTypes, propertyNameType, removeAdditional } = this;
    // The keys removeAdditional deletes still count, as in ajv.
    if (!this.hasPropertyCount(objKeys.length)) {
      return false;
    }
    if (!this.isOpen || this.additionalType || patternTypes.length > 0 || propertyNameType || removeAdditional) {
      for (let i = 0; i < objKeys.length; i += 1) {
        const key = objKeys[i];
        if (propertyNameType && !propertyNameType.isValid(key)) {
          return false;
        }
        let matched = false;
        for (let j = 0; j < patternTypes.length; j += 1) {
          if (patternTypes[j].pattern.test(key)) {
            matched = true;
            if (!patternTypes[j].type.isValid(readCoerced(obj, key, patternTypes[j].type, obj[key]))) {
              return false;
            }
          }
        }
        if (!this.isDeclared(key) && !matched) {
          if (this.removes(obj, key)) {
            delete obj[key];
          } else if (
            !this.isOpen ||
            (this.additionalType && !this.additionalType.isValid(readCoerced(obj, key, this.additionalType, obj[key])))
          ) {
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

  // Whether a number of keys satisfies minProperties and maxProperties.
  hasPropertyCount(count) {
    return !(
      (this.minProperties !== undefined && count < this.minProperties) ||
      (this.maxProperties !== undefined && count > this.maxProperties)
    );
  }

  // Whether a key is declared rather than additional. With removeAdditional, a key only "required" names is additional,
  // as in ajv (`propertyKeys` are the keys "properties" names, see convertObject() in json-schema.js).
  isDeclared(key) {
    if (this.removeAdditional && this.propertyKeys) {
      return this.propertyKeys.includes(key);
    }
    return this.keySet.has(key);
  }

  // Whether removeAdditional deletes the additional property `key` of `obj`.
  removes(obj, key) {
    return (
      this.removeAdditional === 'delete' ||
      (this.removeAdditional === 'failing' && !this.additionalType.isValid(obj[key]))
    );
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
    const { keys: schemaKeys } = this;
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
    if (this.defaults.length > 0) {
      assignDefaults(obj, this.defaults);
    }
    for (let i = 0; i < schemaKeys.length; i += 1) {
      const key = schemaKeys[i];
      const type = this.schema[key];
      const value = readCoerced(obj, key, type, ownValue(obj, key));
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
          const value = readCoerced(obj, key, type, obj[key]);
          if (!type.isValid(value)) {
            errors.push(type.errors(value, keyName));
          }
        }
      });
      if (!this.isDeclared(key) && !matched) {
        if (this.removes(obj, key)) {
          delete obj[key];
        } else if (!this.isOpen) {
          errors.push(`Unexpected key: ${keyName}`);
        } else if (this.additionalType) {
          const value = readCoerced(obj, key, this.additionalType, obj[key]);
          if (!this.additionalType.isValid(value)) {
            errors.push(this.additionalType.errors(value, keyName));
          }
        }
      }
    }
    const count = objKeys.length;
    if (this.minProperties !== undefined && count < this.minProperties) {
      errors.push(`${name} must have at least ${this.minProperties} properties`);
    }
    if (this.maxProperties !== undefined && count > this.maxProperties) {
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
