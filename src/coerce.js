// The option coerceTypes: a value that is not of the JSON type its schema's "type" asks for is converted to one of those
// types when it can be, with ajv's rules, before it is checked. The converted value replaces the original one in the
// object or array it is in; a value that is in neither (the value validated) is converted for the validation only.
const { ValidateType } = require('./types/validate-type');

// The types a value can be converted to, in the order "type" lists them; "array" too with coerceTypes: 'array'.
const COERCIBLE = ['string', 'number', 'integer', 'boolean', 'null'];

// Whether a value is of a JSON type, as the type checks see it (numbers are finite).
const TYPE_TESTS = {
  string: (x) => typeof x === 'string',
  number: (x) => typeof x === 'number' && Number.isFinite(x),
  integer: (x) => Number.isInteger(x),
  boolean: (x) => typeof x === 'boolean',
  null: (x) => x === null,
  object: (x) => x !== null && typeof x === 'object' && !Array.isArray(x),
  array: (x) => Array.isArray(x),
};

const isNumeric = (x) => typeof x === 'string' && x !== '' && !Number.isNaN(Number(x));

// The value converted to a type, or undefined when it cannot be (as in ajv: numbers and booleans to strings, numeric
// strings, booleans and null to numbers, 'true', 'false', 1, 0 and null to booleans, '', 0 and false to null, and any
// primitive to an array of it).
const COERCIONS = {
  string: (x) => {
    if (typeof x === 'number' || typeof x === 'boolean') {
      return String(x);
    }
    return x === null ? '' : undefined;
  },
  number: (x) => (typeof x === 'boolean' || x === null || isNumeric(x) ? Number(x) : undefined),
  integer: (x) =>
    typeof x === 'boolean' || x === null || (isNumeric(x) && Number(x) % 1 === 0) ? Number(x) : undefined,
  boolean: (x) => {
    if (x === 'false' || x === 0 || x === null) {
      return false;
    }
    return x === 'true' || x === 1 ? true : undefined;
  },
  null: (x) => (x === '' || x === 0 || x === false ? null : undefined),
  array: (x) => (x === null || ['string', 'number', 'boolean'].includes(typeof x) ? [x] : undefined),
};

// A value converted for a schema with `spec` ({ types, to, array }, see coerceSpecOf()): { value, assign }, where
// `assign` tells whether the converted value replaces the original one. With coerceTypes: 'array', an array of one
// element is first taken as that element, which is checked even when it is not converted, as in ajv.
function coerce(value, spec) {
  const matches = (x) => spec.types.some((type) => TYPE_TESTS[type](x));
  if (matches(value)) {
    return { value, assign: false };
  }
  let current = value;
  let converted;
  if (spec.array && Array.isArray(current) && current.length === 1) {
    [current] = current;
    if (matches(current)) {
      converted = current;
    }
  }
  for (let i = 0; i < spec.to.length && converted === undefined; i += 1) {
    converted = COERCIONS[spec.to[i]](current);
  }
  return converted === undefined ? { value: current, assign: false } : { value: converted, assign: true };
}

// The conversion a type asks for: its own (coerceSpec, set when converting a schema with "type"), or the one of the
// target of a reference, or of the first part of an allOf that has one.
function coerceSpecOf(type, seen = []) {
  if (!type) {
    return undefined;
  }
  if (type.coerceSpec) {
    return type.coerceSpec;
  }
  // eslint-disable-next-line global-require -- required when used: the types require this module
  const { RefType, AllOfType } = require('./types');
  if (type.constructor === RefType && !seen.includes(type)) {
    return coerceSpecOf(type.getTarget(), [...seen, type]);
  }
  if (type.constructor === AllOfType) {
    for (let i = 0; i < type.types.length; i += 1) {
      const spec = coerceSpecOf(type.types[i], seen);
      if (spec) {
        return spec;
      }
    }
  }
  return undefined;
}

// The value of container[key] for the type that checks it, converted (and written back) when its schema asks.
function readCoerced(container, key, type, value) {
  const spec = value === undefined ? undefined : coerceSpecOf(type);
  if (!spec) {
    return value;
  }
  const result = coerce(value, spec);
  if (result.assign) {
    container[key] = result.value;
  }
  return result.value;
}

// The value validated, converted for the validation only: the schema of the whole value, with coerceTypes (see
// fromJsonSchema() in json-schema.js). Its type checks the converted value, presence included.
class CoerceType extends ValidateType {
  constructor(options = {}) {
    super({ ...options, isMandatory: false, isNullable: true });
    this.type = options.type;
    this.spec = options.spec;
  }

  converted(value) {
    return value === undefined ? value : coerce(value, this.spec).value;
  }

  validate(value, fieldName = undefined) {
    return this.type.validate(this.converted(value), fieldName);
  }

  errors(value, fieldName = undefined) {
    return this.type.errors(this.converted(value), fieldName);
  }

  isValid(value) {
    return this.type.isValid(this.converted(value));
  }
}

module.exports = {
  CoerceType,
  COERCIBLE,
  TYPE_TESTS,
  coerce,
  coerceSpecOf,
  readCoerced,
};
