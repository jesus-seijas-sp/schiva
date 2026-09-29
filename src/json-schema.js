const { Schema } = require('./schema');
const { compileType } = require('./compile');
const { RefIndex } = require('./json-schema-refs');

const {
  AllOfType,
  AnyOfType,
  AnyType,
  ArrayOfType,
  BooleanType,
  ConditionalType,
  FloatType,
  IntegerType,
  NeverType,
  NotType,
  OneOfType,
  RefType,
  StringType,
  ValuesType,
  WhenType,
} = require('./types');

const ANNOTATIONS = [
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  'format',
  'readOnly',
  'writeOnly',
  'deprecated',
  'nullable',
  // Only used through "$ref".
  'definitions',
];

const TYPED_KEYWORDS = {
  properties: 'object',
  patternProperties: 'object',
  dependencies: 'object',
  propertyNames: 'object',
  contains: 'array',
  additionalItems: 'array',
  required: 'object',
  additionalProperties: 'object',
  minProperties: 'object',
  maxProperties: 'object',
  items: 'array',
  minItems: 'array',
  maxItems: 'array',
  uniqueItems: 'array',
  minLength: 'string',
  maxLength: 'string',
  pattern: 'string',
  minimum: 'number',
  maximum: 'number',
  exclusiveMinimum: 'number',
  exclusiveMaximum: 'number',
  multipleOf: 'number',
};

const UNTYPED_KEYWORDS = ['type', 'enum', 'const', 'anyOf', 'oneOf', 'not', 'allOf', 'if', 'then', 'else'];

const TYPE_NAMES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];

function getTypeNames(json) {
  if (json.type === undefined) {
    return [];
  }
  return Array.isArray(json.type) ? json.type : [json.type];
}

function checkKeywords(json, path) {
  const typeNames = getTypeNames(json);
  typeNames.forEach((typeName) => {
    if (!TYPE_NAMES.includes(typeName)) {
      throw new Error(`Unsupported JSON Schema type "${typeName}" at ${path}`);
    }
  });
  Object.keys(json).forEach((keyword) => {
    if (ANNOTATIONS.includes(keyword) || UNTYPED_KEYWORDS.includes(keyword)) {
      return;
    }
    const requiredType = TYPED_KEYWORDS[keyword];
    if (!requiredType) {
      throw new Error(`Unsupported JSON Schema keyword "${keyword}" at ${path}`);
    }
    // Without "type" a keyword only applies to values of its type. With a "type" that excludes it, the keyword could
    // never apply, which is most likely a mistake.
    const isDeclared = typeNames.includes(requiredType) || (requiredType === 'number' && typeNames.includes('integer'));
    if (typeNames.length > 0 && !isDeclared) {
      throw new Error(`JSON Schema keyword "${keyword}" at ${path} requires "type": "${requiredType}"`);
    }
  });
}

// State of the conversion in progress: the reference index of the document, the types converted for reference
// targets, and the references still to resolve.
let context;

// null is valid only if every constraint of the node accepts it. `seen` stops at reference cycles, which give no
// value that accepts null.
function acceptsNull(json, seen = new Set()) {
  if (json === true) {
    return true;
  }
  if (json === false || json === null || typeof json !== 'object') {
    return false;
  }
  if (json.$ref !== undefined) {
    const target = context.index.resolve(json);
    if (target === undefined || seen.has(json)) {
      return false;
    }
    // `seen` holds the references being followed, so a target reached again through another path is not a cycle.
    seen.add(json);
    const result = acceptsNull(target, seen);
    seen.delete(json);
    return result;
  }
  if (json.nullable === true) {
    return true;
  }
  const checks = [];
  if (json.type !== undefined) {
    checks.push(getTypeNames(json).includes('null'));
  }
  if (json.enum) {
    checks.push(json.enum.includes(null));
  }
  if ('const' in json) {
    checks.push(json.const === null);
  }
  if (json.anyOf) {
    checks.push(json.anyOf.some((item) => acceptsNull(item, seen)));
  }
  if (json.oneOf) {
    checks.push(json.oneOf.filter((item) => acceptsNull(item, seen)).length === 1);
  }
  if (json.not !== undefined) {
    checks.push(!acceptsNull(json.not, seen));
  }
  if (json.allOf) {
    checks.push(json.allOf.every((item) => acceptsNull(item, seen)));
  }
  if (json.if !== undefined) {
    const branch = acceptsNull(json.if, seen) ? json.then : json.else;
    checks.push(branch === undefined || acceptsNull(branch, seen));
  }
  return checks.every(Boolean);
}

// Inner types of a combination only check non-null values: the outer type owns mandatory/nullable.
function asInner(type) {
  type.isMandatory = false;
  type.isNullable = true;

  return type;
}

function combine(types, Type) {
  if (types.length === 0) {
    return new AnyType();
  }
  if (types.length === 1) {
    return types[0];
  }
  return new Type({ types: types.map(asInner) });
}

let convert;

// A list of required properties, or a schema the whole object must satisfy, for each key.
function convertDependencies(json, path) {
  const dependencies = json.dependencies || {};
  return Object.keys(dependencies).map((key) => {
    const dependency = dependencies[key];
    if (Array.isArray(dependency)) {
      if (!dependency.every((property) => typeof property === 'string')) {
        throw new Error(`Unsupported JSON Schema at ${path}.dependencies.${key}: expected property names`);
      }
      return { key, required: dependency };
    }
    return { key, type: asInner(convert(dependency, `${path}.dependencies.${key}`)) };
  });
}

function convertObject(json, path) {
  const properties = json.properties || {};
  const required = json.required || [];
  const { additionalProperties } = json;
  const additionalType =
    additionalProperties !== undefined && typeof additionalProperties === 'object'
      ? convert(additionalProperties, `${path}.additionalProperties`)
      : undefined;
  // No prototype: keys such as __proto__ or toString must be plain entries.
  const definition = Object.create(null);
  Object.keys(properties).forEach((key) => {
    definition[key] = convert(properties[key], `${path}.properties.${key}`, required.includes(key));
  });
  required
    .filter((key) => !Object.prototype.hasOwnProperty.call(definition, key))
    .forEach((key) => {
      definition[key] = additionalType
        ? convert(additionalProperties, `${path}.additionalProperties`)
        : new AnyType({ isNullable: true });
    });
  const patternProperties = json.patternProperties || {};
  const patternTypes = Object.keys(patternProperties).map((source) => ({
    pattern: new RegExp(source, 'u'),
    type: convert(patternProperties[source], `${path}.patternProperties.${source}`),
  }));
  return new Schema(definition, {
    isOpen: additionalProperties !== false,
    additionalType,
    patternTypes,
    dependencies: convertDependencies(json, path),
    propertyNameType:
      json.propertyNames === undefined ? undefined : convert(json.propertyNames, `${path}.propertyNames`),
    minProperties: json.minProperties,
    maxProperties: json.maxProperties,
  });
}

function convertArray(json, path) {
  const { items } = json;
  let type;
  if (Array.isArray(items)) {
    type = items.map((item, i) => convert(item, `${path}.items[${i}]`, false));
  } else if (items !== undefined) {
    type = convert(items, `${path}.items`);
  }
  // Elements are values of their own: null is checked, not skipped.
  const contains = json.contains === undefined ? undefined : convert(json.contains, `${path}.contains`);
  // Only used after the positions of an items array.
  const additionalType =
    Array.isArray(items) && json.additionalItems !== undefined
      ? convert(json.additionalItems, `${path}.additionalItems`)
      : undefined;
  return new ArrayOfType({
    type,
    min: json.minItems,
    max: json.maxItems,
    unique: json.uniqueItems,
    contains,
    additionalType,
  });
}

function convertNumber(json, Type, path) {
  if (json.multipleOf !== undefined && !(typeof json.multipleOf === 'number' && json.multipleOf > 0)) {
    throw new Error(`Unsupported JSON Schema at ${path}: "multipleOf" must be a number greater than 0`);
  }
  return new Type({
    min: json.minimum,
    max: json.maximum,
    exclusiveMin: json.exclusiveMinimum,
    exclusiveMax: json.exclusiveMaximum,
    multipleOf: json.multipleOf,
  });
}

function convertTypeName(typeName, json, path) {
  switch (typeName) {
    case 'object':
      return convertObject(json, path);
    case 'array':
      return convertArray(json, path);
    case 'string':
      return new StringType({
        min: json.minLength,
        max: json.maxLength,
        pattern: json.pattern === undefined ? undefined : new RegExp(json.pattern, 'u'),
        allowEmpty: false,
        countCodePoints: true,
      });
    case 'number':
      return convertNumber(json, FloatType, path);
    case 'integer':
      return convertNumber(json, IntegerType, path);
    case 'boolean':
      return new BooleanType();
    default:
      return new ValuesType({ values: [null], isNullable: true });
  }
}

// Keywords of a schema without "type": each group of them checks only the values of its JSON type.
function convertUntyped(json, path) {
  const jsonTypes = [...new Set(Object.keys(json).map((keyword) => TYPED_KEYWORDS[keyword]))].filter(Boolean);
  return jsonTypes.map((jsonType) => new WhenType({ jsonType, type: asInner(convertTypeName(jsonType, json, path)) }));
}

convert = (json, path, isMandatory = true) => {
  if (json === true) {
    return new AnyType({ isMandatory, isNullable: true });
  }
  if (json === false) {
    return new NeverType({ isMandatory, isNullable: false });
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error(`Unsupported JSON Schema at ${path}: expected an object or a boolean`);
  }
  if (json.$ref !== undefined) {
    // In draft-07 every keyword next to "$ref" is ignored.
    if (typeof json.$ref !== 'string') {
      throw new Error(`Unsupported JSON Schema at ${path}: "$ref" must be a string`);
    }
    const ref = new RefType({ ref: json.$ref, isMandatory, isNullable: true });
    context.pending.push({ ref, json, path });
    return ref;
  }
  checkKeywords(json, path);
  const typeNames = getTypeNames(json);
  const nonNullNames = typeNames.filter((typeName) => typeName !== 'null');
  const namesToConvert = nonNullNames.length > 0 ? nonNullNames : typeNames;
  const constraints = [];
  if (namesToConvert.length === 0) {
    constraints.push(...convertUntyped(json, path));
  } else {
    constraints.push(
      combine(
        namesToConvert.map((typeName) => convertTypeName(typeName, json, path)),
        AnyOfType
      )
    );
  }
  if (json.enum) {
    constraints.push(new ValuesType({ values: json.enum }));
  }
  if ('const' in json) {
    constraints.push(new ValuesType({ values: [json.const] }));
  }
  if (json.anyOf) {
    constraints.push(
      combine(
        json.anyOf.map((item, i) => convert(item, `${path}.anyOf[${i}]`)),
        AnyOfType
      )
    );
  }
  if (json.oneOf) {
    if (!Array.isArray(json.oneOf) || json.oneOf.length === 0) {
      throw new Error(`Unsupported JSON Schema at ${path}: "oneOf" must be a non-empty array`);
    }
    const types = json.oneOf.map((item, i) => asInner(convert(item, `${path}.oneOf[${i}]`)));
    constraints.push(new OneOfType({ types }));
  }
  if (json.not !== undefined) {
    constraints.push(new NotType({ type: asInner(convert(json.not, `${path}.not`)) }));
  }
  if (json.allOf) {
    json.allOf.forEach((item, i) => constraints.push(convert(item, `${path}.allOf[${i}]`)));
  }
  // "then" and "else" are ignored without "if", and "if" alone checks nothing.
  if (json.if !== undefined && (json.then !== undefined || json.else !== undefined)) {
    const branch = (keyword) =>
      json[keyword] === undefined ? undefined : asInner(convert(json[keyword], `${path}.${keyword}`));
    constraints.push(
      new ConditionalType({
        ifType: asInner(convert(json.if, `${path}.if`)),
        thenType: branch('then'),
        elseType: branch('else'),
      })
    );
  }
  const type = combine(constraints, AllOfType);
  type.isMandatory = isMandatory;
  type.isNullable = acceptsNull(json);
  return type;
};

// Points every reference to the type of its target, converting each target once. Converting a target can add
// references, which the loop resolves too.
function resolveReferences() {
  while (context.pending.length > 0) {
    const { ref, json, path } = context.pending.shift();
    const target = context.index.resolve(json);
    if (target === undefined) {
      throw new Error(
        `Unsupported JSON Schema "$ref": "${json.$ref}" at ${path}: only references within the schema or to documents in the "schemas" option are supported`
      );
    }
    if (!context.targets.has(target)) {
      context.targets.set(target, convert(target, json.$ref));
    }
    ref.target = context.targets.get(target);
  }
}

// Builds a validation type from a JSON Schema (draft-07). Throws on unsupported keywords instead of silently ignoring
// them. "$ref" can point within the schema or to the documents in options.schemas, given as { uri: schema } or as an
// array of schemas with "$id"; they are only converted where referenced.
function fromJsonSchema(json, options = {}) {
  context = { index: new RefIndex(json, options.schemas), targets: new Map(), pending: [] };
  try {
    const type = convert(json, '#');
    context.targets.set(json, type);
    resolveReferences();
    return type;
  } finally {
    context = undefined;
  }
}

// Compatibility with ajv compile: returns a function that gives the list of errors for a value (empty when valid).
// With allErrors: false it stops at the first failing check and gives only that error. With errors: false it gives
// true or false instead, for when only validity matters. options.schemas registers other documents for "$ref", as in
// fromJsonSchema().
function compileJsonSchema(json, options = {}) {
  return compileType(fromJsonSchema(json, options), options);
}

module.exports = {
  fromJsonSchema,
  compileJsonSchema,
};
