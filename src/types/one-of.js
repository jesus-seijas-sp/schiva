const { ValidateType, toTypes } = require('./validate-type');

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// What a discriminator picks for a value (see OneOfType.pick()): no type (the value is invalid), or every type as
// oneOf checks them.
const NO_TYPE = -1;
const EVERY_TYPE = -2;

// Value must satisfy exactly one of the types. When none does, reports the errors of every type, like AnyOfType.
// With `discriminator` ({ tag, mapping, exact, auto }: the index of the type for each value of the property `tag`), an
// object is checked only against the type its value of `tag` picks (see discriminatorOf() in json-schema.js).
class OneOfType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.types = toTypes(options.types, 'OneOf types') || [];
    this.discriminator = options.discriminator;
  }

  // The index of the type a discriminator picks for the value: the one the value of its tag (an own property) names;
  // NO_TYPE for an object whose tag names none; EVERY_TYPE without a discriminator, for other values, and for an
  // object whose tag names none when the discriminator was found in a plain oneOf (`auto`), which checks it as oneOf.
  pick(value) {
    if (!this.discriminator || !isObject(value)) {
      return EVERY_TYPE;
    }
    const { tag, mapping, auto } = this.discriminator;
    const tagValue = Object.prototype.hasOwnProperty.call(value, tag) ? value[tag] : undefined;
    if (typeof tagValue === 'string' && mapping.has(tagValue)) {
      return mapping.get(tagValue);
    }
    return auto ? EVERY_TYPE : NO_TYPE;
  }

  // The error about the tag of an object whose tag names no type, after the name of the tag.
  tagError(value) {
    const { tag, mapping } = this.discriminator;
    const tagValue = Object.prototype.hasOwnProperty.call(value, tag) ? value[tag] : undefined;
    if (tagValue === undefined) {
      return ' is mandatory';
    }
    if (typeof tagValue !== 'string') {
      return ' must be a string';
    }
    const values = [...mapping.keys()];
    return values.length === 1 ? ` must be equal to ${values[0]}` : ` must be one of: ${values.join(', ')}`;
  }

  // Number of types the value satisfies, counting up to 2.
  countMatches(value) {
    let matches = 0;
    for (let i = 0; i < this.types.length && matches < 2; i += 1) {
      if (this.types[i].isValid(value)) {
        matches += 1;
      }
    }
    return matches;
  }

  // The field name goes to the alternatives as received (see AllOfType.validate()).
  validate(value, fieldName = undefined) {
    const name = fieldName || 'Value';
    const result = super.validate(value, name);
    if (result) {
      return result;
    }
    const picked = this.pick(value);
    if (picked === NO_TYPE) {
      const { tag } = this.discriminator;
      return `${fieldName ? `${fieldName}.${tag}` : tag}${this.tagError(value)}`;
    }
    if (picked !== EVERY_TYPE) {
      return this.types[picked].validate(value, fieldName);
    }
    if (value !== undefined && value !== null) {
      const matches = this.countMatches(value);
      if (this.types.length === 0) {
        return `${name} must match exactly one schema, but matches none`;
      }
      if (matches === 0) {
        return this.types.map((type) => type.errors(value, fieldName));
      }
      if (matches > 1) {
        return `${name} must match exactly one schema, but matches more than one`;
      }
    }
    return undefined;
  }

  isValid(value) {
    const presence = this.checkPresence(value);
    if (presence !== undefined) {
      return presence;
    }
    const picked = this.pick(value);
    if (picked === EVERY_TYPE) {
      return this.countMatches(value) === 1;
    }
    return picked !== NO_TYPE && this.types[picked].isValid(value);
  }
}

function OneOf(options) {
  return new OneOfType(options);
}

function oneOf(types, isMandatory = true, isNullable = false) {
  if (types !== undefined && types !== null && !Array.isArray(types) && typeof types === 'object') {
    return new OneOfType(types);
  }
  return new OneOfType({ types, isMandatory, isNullable });
}

function ooneOf(types, isMandatory = false, isNullable = false) {
  if (types !== undefined && types !== null && !Array.isArray(types) && typeof types === 'object') {
    return new OneOfType({ isMandatory: false, ...types });
  }
  return new OneOfType({ types, isMandatory, isNullable });
}

module.exports = {
  OneOfType,
  NO_TYPE,
  EVERY_TYPE,
  OneOf,
  oneOf,
  ooneOf,
};
