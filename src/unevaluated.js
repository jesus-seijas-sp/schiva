// "unevaluatedProperties" and "unevaluatedItems" (JSON Schema 2019-09 and 2020-12): the keys or elements of a value
// that no other keyword of the schema evaluated must satisfy a schema. Which ones were evaluated depends on the value:
// a keyword such as "properties" evaluates the keys it names, and an applicator ("anyOf", "oneOf", "if", "$ref",
// "dependentSchemas") passes on what its subschemas evaluated, but only from the ones the value satisfies. "allOf"
// passes on what all of them evaluate: when one fails, the allOf fails, so what it evaluated never counts.
// When what the other keywords evaluate does not depend on the value, staticEvaluated() gives it to the compiler.
const { Schema } = require('./schema');
const { ClosedSchema } = require('./closed-schema');
const {
  AllOfType,
  AnyOfType,
  ArrayOfType,
  ConditionalType,
  NeverType,
  OneOfType,
  RefType,
  ValidateType,
  WhenType,
  isJsonType,
} = require('./types');
const { NO_TYPE, EVERY_TYPE } = require('./types/one-of');

// What a type evaluated: true for everything, or a Set of keys (or of element indexes).
const ALL = true;

// Kinds of element: keys of objects or indexes of arrays.
const JSON_TYPES = { properties: 'object', items: 'array' };

function merge(target, result) {
  if (result === ALL || target === ALL) {
    return ALL;
  }
  result.forEach((item) => target.add(item));
  return target;
}

// What `type` evaluates of `value`, for kind 'properties' or 'items'. `seen` holds the references being followed with
// their values, to stop at cycles.
let evaluated;

const evaluatedByAll = (kind, types, value, seen) =>
  types.reduce((result, item) => merge(result, evaluated(kind, item, value, seen)), new Set());

// Keys of the object `value` that a Schema evaluates: the ones "properties" names or a pattern matches, all of them
// with "additionalProperties", and what the "dependentSchemas" of its present keys evaluate.
function schemaKeys(type, value, seen) {
  if (type.evaluatesAllKeys || !type.isOpen || type.additionalType) {
    return ALL;
  }
  const declared = type.propertyKeys ? new Set(type.propertyKeys) : type.keySet;
  let keys = new Set();
  Object.keys(value).forEach((key) => {
    if (declared.has(key) || type.patternTypes.some(({ pattern }) => pattern.test(key))) {
      keys.add(key);
    }
  });
  type.dependencies.forEach((dependency) => {
    const isPresent = Object.prototype.hasOwnProperty.call(value, dependency.key);
    if (dependency.type && isPresent && dependency.type.isValid(value)) {
      keys = merge(keys, evaluated('properties', dependency.type, value, seen));
    }
  });
  return keys;
}

// Indexes of the array `value` that an ArrayOf evaluates: the positions of a tuple, all of them with a type for every
// element or after the tuple, and in draft 2020-12 the ones that match "contains".
function arrayItems(type, value) {
  if ((type.type && !Array.isArray(type.type)) || type.additionalType) {
    return ALL;
  }
  const items = new Set();
  if (Array.isArray(type.type)) {
    for (let i = 0; i < Math.min(type.type.length, value.length); i += 1) {
      items.add(i);
    }
  }
  if (type.contains && type.containsEvaluates) {
    value.forEach((item, i) => {
      if (type.contains.isValid(item)) {
        items.add(i);
      }
    });
  }
  return items;
}

// Checks the keys or elements of a value that the other keywords of its schema, `siblings`, leave: they must satisfy
// `type`. `kind` is 'properties' or 'items'. It checks only values of the JSON type of its kind.
class UnevaluatedType extends ValidateType {
  constructor(options = {}) {
    super(options);
    this.kind = options.kind;
    this.jsonType = JSON_TYPES[options.kind];
    this.siblings = options.siblings || [];
    this.type = options.type;
  }

  // Keys or indexes that the siblings do not evaluate. What the siblings evaluate counts even from the ones that fail,
  // so an invalid property is reported once, by the keyword that checks it.
  unevaluated(value) {
    const done = evaluatedByAll(this.kind, this.siblings, value, []);
    if (done === ALL) {
      return [];
    }
    const elements = this.kind === 'properties' ? Object.keys(value) : value.map((item, i) => i);
    return elements.filter((element) => !done.has(element));
  }

  isValid(value) {
    const presence = this.checkPresence(value);
    if (presence !== undefined) {
      return presence;
    }
    if (!isJsonType(value, this.jsonType)) {
      return true;
    }
    return this.unevaluated(value).every((element) => this.type.isValid(value[element]));
  }

  // Keys are named like the keys of a Schema, and a key no schema allows like its "additionalProperties": false.
  errors(value, fieldName) {
    const presence = super.validate(value, fieldName || 'Value');
    if (presence !== undefined) {
      return presence;
    }
    if (!isJsonType(value, this.jsonType)) {
      return [];
    }
    return this.unevaluated(value)
      .filter((element) => !this.type.isValid(value[element]))
      .map((element) => {
        if (this.kind === 'items') {
          return this.type.errors(value[element], `${fieldName || 'Value'}[${element}]`);
        }
        const keyName = fieldName ? `${fieldName}.${element}` : element;
        return this.type instanceof NeverType
          ? `Unexpected key: ${keyName}`
          : this.type.errors(value[element], keyName);
      });
  }

  validate(value, fieldName) {
    return this.isValid(value) ? undefined : this.errors(value, fieldName);
  }
}

evaluated = (kind, type, value, seen = []) => {
  switch (type.constructor) {
    case Schema:
    case ClosedSchema:
      return kind === 'properties' ? schemaKeys(type, value, seen) : new Set();
    case ArrayOfType:
      return kind === 'items' ? arrayItems(type, value) : new Set();
    case AllOfType:
      return evaluatedByAll(kind, type.types, value, seen);
    case AnyOfType:
      return evaluatedByAll(
        kind,
        type.types.filter((item) => item.isValid(value)),
        value,
        seen
      );
    case OneOfType: {
      // With a discriminator, the type it picks, when the value satisfies it.
      const picked = type.pick(value);
      if (picked !== EVERY_TYPE) {
        const isPicked = picked !== NO_TYPE && type.types[picked].isValid(value);
        return isPicked ? evaluated(kind, type.types[picked], value, seen) : new Set();
      }
      const valid = type.types.filter((item) => item.isValid(value));
      return valid.length === 1 ? evaluated(kind, valid[0], value, seen) : new Set();
    }
    case ConditionalType: {
      // The annotations of "if" count when the value satisfies it.
      if (type.ifType.isValid(value)) {
        const result = evaluated(kind, type.ifType, value, seen);
        return type.thenType && type.thenType.isValid(value)
          ? merge(result, evaluated(kind, type.thenType, value, seen))
          : result;
      }
      return type.elseType && type.elseType.isValid(value) ? evaluated(kind, type.elseType, value, seen) : new Set();
    }
    case RefType:
      if (seen.some(([ref, seenValue]) => ref === type && seenValue === value)) {
        return new Set();
      }
      return evaluated(kind, type.getTarget(), value, [...seen, [type, value]]);
    case WhenType:
      return isJsonType(value, type.jsonType) ? evaluated(kind, type.type, value, seen) : new Set();
    case UnevaluatedType:
      // Evaluates everything the other keywords leave, when those elements satisfy it.
      if (type.kind === kind && type.isValid(value)) {
        return ALL;
      }
      return evaluatedByAll(kind, type.siblings, value, seen);
    default:
      return new Set();
  }
};

// What `type` evaluates for any value, when it does not depend on the value: { all } for everything, else the
// declared keys, the patterns of keys and the length of a tuple (the evaluated indexes are the ones below it).
// Undefined when it depends on the value.
const NONE = { all: false, keys: [], patterns: [], prefix: 0 };
const EVERYTHING = { ...NONE, all: true };

function union(a, b) {
  if (a === undefined || b === undefined) {
    return undefined;
  }
  return {
    all: a.all || b.all,
    keys: [...a.keys, ...b.keys],
    patterns: [...a.patterns, ...b.patterns],
    prefix: Math.max(a.prefix, b.prefix),
  };
}

const isNone = (result) =>
  result !== undefined &&
  !result.all &&
  result.keys.length === 0 &&
  result.patterns.length === 0 &&
  result.prefix === 0;

let staticOf;

const staticOfAll = (kind, types, seen) =>
  types.reduce((result, item) => union(result, staticOf(kind, item, seen)), NONE);

// Alternatives pass on what the ones that match evaluate, which depends on the value, unless none evaluates anything.
const staticOfAlternatives = (kind, types, seen) =>
  types.every((item) => item === undefined || isNone(staticOf(kind, item, seen))) ? NONE : undefined;

staticOf = (kind, type, seen = []) => {
  switch (type.constructor) {
    case Schema:
    case ClosedSchema:
      if (kind !== 'properties') {
        return NONE;
      }
      if (type.evaluatesAllKeys || !type.isOpen || type.additionalType) {
        return EVERYTHING;
      }
      if (type.dependencies.some((dependency) => dependency.type && !isNone(staticOf(kind, dependency.type, seen)))) {
        return undefined;
      }
      return {
        ...NONE,
        keys: type.propertyKeys || type.keys,
        patterns: type.patternTypes.map(({ pattern }) => pattern),
      };
    case ArrayOfType:
      if (kind !== 'items') {
        return NONE;
      }
      if ((type.type && !Array.isArray(type.type)) || type.additionalType) {
        return EVERYTHING;
      }
      if (type.contains && type.containsEvaluates) {
        return undefined;
      }
      return { ...NONE, prefix: Array.isArray(type.type) ? type.type.length : 0 };
    case AllOfType:
      return staticOfAll(kind, type.types, seen);
    case AnyOfType:
    case OneOfType:
      return staticOfAlternatives(kind, type.types, seen);
    case ConditionalType:
      return staticOfAlternatives(kind, [type.ifType, type.thenType, type.elseType], seen);
    case RefType:
      return seen.includes(type) ? undefined : staticOf(kind, type.getTarget(), [...seen, type]);
    case WhenType:
      return type.jsonType === JSON_TYPES[kind] ? staticOf(kind, type.type, seen) : NONE;
    case UnevaluatedType:
      return type.kind === kind ? EVERYTHING : staticOfAll(kind, type.siblings, seen);
    default:
      return NONE;
  }
};

const withKeySet = (result) => result && { ...result, keys: new Set(result.keys) };

// What `types` evaluate together for any value, of kind 'properties' or 'items', or undefined when it depends on the
// value.
function staticEvaluatedByAll(kind, types) {
  return withKeySet(staticOfAll(kind, types, []));
}

// What `type` evaluates for any value, of kind 'properties' or 'items', or undefined when it depends on the value.
function staticEvaluatedBy(kind, type) {
  return withKeySet(staticOf(kind, type, []));
}

module.exports = {
  JSON_TYPES,
  UnevaluatedType,
  staticEvaluatedBy,
  staticEvaluatedByAll,
};
