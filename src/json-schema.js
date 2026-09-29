const { Schema } = require('./schema');
const { compileType } = require('./compile');
const { RefIndex } = require('./json-schema-refs');
const { UnevaluatedType } = require('./unevaluated');

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

// Drafts by the "$schema" URI (without its empty fragment) that selects them.
const DRAFT_URIS = {
  'http://json-schema.org/draft-07/schema': 'draft-07',
  'https://json-schema.org/draft-07/schema': 'draft-07',
  'https://json-schema.org/draft/2019-09/schema': '2019-09',
  'http://json-schema.org/draft/2019-09/schema': '2019-09',
  'https://json-schema.org/draft/2020-12/schema': '2020-12',
  'http://json-schema.org/draft/2020-12/schema': '2020-12',
};
const DRAFTS = ['draft-07', '2019-09', '2020-12'];

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
  'contentMediaType',
  'contentEncoding',
  'contentSchema',
  // Only used through "$ref"; "$defs" is also accepted in draft-07.
  'definitions',
  '$defs',
];

// Keywords that only exist from a draft on, as annotations or checked by the code below.
const ANNOTATIONS_2019 = ['$anchor', '$vocabulary', '$recursiveAnchor'];
const ANNOTATIONS_2020 = ['$dynamicAnchor'];

// Keywords of the later drafts that are not supported yet: they throw rather than being ignored.
const NOT_SUPPORTED_YET = ['$recursiveRef', '$dynamicRef'];

// Keywords that exist only in some drafts, with the drafts that have them.
const DRAFT_KEYWORDS = {
  additionalItems: ['draft-07', '2019-09'],
  dependentRequired: ['2019-09', '2020-12'],
  dependentSchemas: ['2019-09', '2020-12'],
  minContains: ['2019-09', '2020-12'],
  maxContains: ['2019-09', '2020-12'],
  prefixItems: ['2020-12'],
  unevaluatedProperties: ['2019-09', '2020-12'],
  unevaluatedItems: ['2019-09', '2020-12'],
};

const TYPED_KEYWORDS = {
  properties: 'object',
  patternProperties: 'object',
  dependencies: 'object',
  propertyNames: 'object',
  dependentRequired: 'object',
  dependentSchemas: 'object',
  contains: 'array',
  minContains: 'array',
  maxContains: 'array',
  prefixItems: 'array',
  additionalItems: 'array',
  unevaluatedItems: 'array',
  required: 'object',
  additionalProperties: 'object',
  unevaluatedProperties: 'object',
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

// State of the conversion in progress: the draft, the reference index of the document, the types converted for
// reference targets, and the references still to resolve.
let context;

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
  const { draft } = context;
  Object.keys(json).forEach((keyword) => {
    if (
      ANNOTATIONS.includes(keyword) ||
      UNTYPED_KEYWORDS.includes(keyword) ||
      (draft !== 'draft-07' && ANNOTATIONS_2019.includes(keyword)) ||
      (draft === '2020-12' && ANNOTATIONS_2020.includes(keyword))
    ) {
      return;
    }
    if (NOT_SUPPORTED_YET.includes(keyword)) {
      throw new Error(`JSON Schema keyword "${keyword}" at ${path} is not supported yet`);
    }
    const requiredType = TYPED_KEYWORDS[keyword];
    if (!requiredType || (DRAFT_KEYWORDS[keyword] && !DRAFT_KEYWORDS[keyword].includes(draft))) {
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

// The draft of a schema: options.draft, or the one its "$schema" names. Without either, or with another "$schema",
// the schema is read as draft-07, as before later drafts were supported.
function draftOf(json, options) {
  if (options.draft !== undefined) {
    if (!DRAFTS.includes(options.draft)) {
      throw new Error(`Unsupported JSON Schema option "draft": "${options.draft}" is not one of ${DRAFTS.join(', ')}`);
    }
    return options.draft;
  }
  const uri = json !== null && typeof json === 'object' && typeof json.$schema === 'string' ? json.$schema : '';
  return DRAFT_URIS[uri.replace(/#$/, '')] || 'draft-07';
}

// The keywords of a node other than "$ref", which later drafts apply next to it; undefined when there are none but
// annotations.
function besideRef(json) {
  const { $ref, ...rest } = json;
  const isAnnotation = (keyword) =>
    ANNOTATIONS.includes(keyword) || ANNOTATIONS_2019.includes(keyword) || ANNOTATIONS_2020.includes(keyword);
  return Object.keys(rest).every(isAnnotation) ? undefined : rest;
}

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
    const rest = context.draft === 'draft-07' ? undefined : besideRef(json);
    return result && (rest === undefined || acceptsNull(rest, seen));
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

function requiredDependency(key, dependency, path) {
  if (!Array.isArray(dependency) || !dependency.every((property) => typeof property === 'string')) {
    throw new Error(`Unsupported JSON Schema at ${path}: expected property names`);
  }
  return { key, required: dependency };
}

// A list of required properties, or a schema the whole object must satisfy, for each key: from "dependencies", and
// from "dependentRequired" and "dependentSchemas", which split it in two from draft 2019-09 on.
function convertDependencies(json, path) {
  const dependencies = json.dependencies || {};
  const dependentRequired = json.dependentRequired || {};
  const dependentSchemas = json.dependentSchemas || {};
  return [
    ...Object.keys(dependencies).map((key) => {
      const dependency = dependencies[key];
      const at = `${path}.dependencies.${key}`;
      return Array.isArray(dependency)
        ? requiredDependency(key, dependency, at)
        : { key, type: asInner(convert(dependency, at)) };
    }),
    ...Object.keys(dependentRequired).map((key) =>
      requiredDependency(key, dependentRequired[key], `${path}.dependentRequired.${key}`)
    ),
    ...Object.keys(dependentSchemas).map((key) => ({
      key,
      type: asInner(convert(dependentSchemas[key], `${path}.dependentSchemas.${key}`)),
    })),
  ];
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
  const schema = new Schema(definition, {
    isOpen: additionalProperties !== false,
    additionalType,
    patternTypes,
    dependencies: convertDependencies(json, path),
    propertyNameType:
      json.propertyNames === undefined ? undefined : convert(json.propertyNames, `${path}.propertyNames`),
    minProperties: json.minProperties,
    maxProperties: json.maxProperties,
  });
  // For "unevaluatedProperties": the keys "properties" names (the schema also declares the ones only "required"
  // names), and whether "additionalProperties" evaluates every other key, as it does even when it is true.
  schema.propertyKeys = Object.keys(properties);
  schema.evaluatesAllKeys = additionalProperties !== undefined;
  return schema;
}

const tuple = (items, keyword, path) => items.map((item, i) => convert(item, `${path}.${keyword}[${i}]`, false));

function convertArray(json, path) {
  const { items } = json;
  let type;
  let additionalType;
  if (context.draft === '2020-12') {
    // "prefixItems" is the tuple, and "items" the type of the elements after it (or of all of them).
    if (Array.isArray(items)) {
      throw new Error(`Unsupported JSON Schema at ${path}: in draft 2020-12 "items" is a schema; use "prefixItems"`);
    }
    const rest = items === undefined ? undefined : convert(items, `${path}.items`);
    if (json.prefixItems !== undefined) {
      if (!Array.isArray(json.prefixItems)) {
        throw new Error(`Unsupported JSON Schema at ${path}: "prefixItems" must be an array`);
      }
      type = tuple(json.prefixItems, 'prefixItems', path);
      additionalType = rest;
    } else {
      type = rest;
    }
  } else {
    if (Array.isArray(items)) {
      type = tuple(items, 'items', path);
    } else if (items !== undefined) {
      type = convert(items, `${path}.items`);
    }
    // Only used after the positions of an items array.
    additionalType =
      Array.isArray(items) && json.additionalItems !== undefined
        ? convert(json.additionalItems, `${path}.additionalItems`)
        : undefined;
  }
  // Elements are values of their own: null is checked, not skipped.
  const contains = json.contains === undefined ? undefined : convert(json.contains, `${path}.contains`);
  const array = new ArrayOfType({
    type,
    min: json.minItems,
    max: json.maxItems,
    unique: json.uniqueItems,
    contains,
    minContains: json.minContains,
    maxContains: json.maxContains,
    additionalType,
  });
  // For "unevaluatedItems": in draft 2020-12 "contains" evaluates the elements it matches.
  array.containsEvaluates = context.draft === '2020-12';
  return array;
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

// Adds "unevaluatedProperties" and "unevaluatedItems" to the types of the other keywords of a node, which decide
// what they leave to check.
function addUnevaluated(parts, json, path) {
  const siblings = [...parts];
  if (json.unevaluatedProperties !== undefined) {
    const type = convert(json.unevaluatedProperties, `${path}.unevaluatedProperties`);
    parts.push(new UnevaluatedType({ kind: 'properties', siblings, type }));
  }
  if (json.unevaluatedItems !== undefined) {
    const type = convert(json.unevaluatedItems, `${path}.unevaluatedItems`);
    parts.push(new UnevaluatedType({ kind: 'items', siblings, type }));
  }
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
    if (typeof json.$ref !== 'string') {
      throw new Error(`Unsupported JSON Schema at ${path}: "$ref" must be a string`);
    }
    const ref = new RefType({ ref: json.$ref, isMandatory, isNullable: true });
    context.pending.push({ ref, json, path });
    // In draft-07 every keyword next to "$ref" is ignored; later drafts apply them too.
    const rest = context.draft === 'draft-07' ? undefined : besideRef(json);
    if (rest === undefined) {
      return ref;
    }
    // The reference counts as one of the keywords that evaluate properties and elements for "unevaluated*".
    const { unevaluatedProperties, unevaluatedItems, ...others } = rest;
    const parts = [ref];
    if (besideRef(others) !== undefined) {
      parts.push(convert(others, path));
    }
    addUnevaluated(parts, json, path);
    const type = new AllOfType({ types: parts.map(asInner) });
    type.isMandatory = isMandatory;
    type.isNullable = acceptsNull(json);
    return type;
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
  // "then" and "else" are ignored without "if", and "if" alone checks nothing. From draft 2019-09 on it is kept even
  // alone, as what it evaluates counts for an "unevaluated*" of this node or of one that refers to it.
  const keepsIf = json.then !== undefined || json.else !== undefined || context.draft !== 'draft-07';
  if (json.if !== undefined && keepsIf) {
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
  addUnevaluated(constraints, json, path);
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

// Builds a validation type from a JSON Schema (draft-07, 2019-09 or 2020-12: see draftOf()). Throws on unsupported
// keywords instead of silently ignoring them. "$ref" can point within the schema or to the documents in
// options.schemas, given as { uri: schema } or as an array of schemas with "$id"; they are only converted where
// referenced.
function fromJsonSchema(json, options = {}) {
  const draft = draftOf(json, options);
  context = { draft, index: new RefIndex(json, options.schemas, draft), targets: new Map(), pending: [] };
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
// true or false instead, for when only validity matters. options.schemas registers other documents for "$ref", and
// options.draft chooses the draft, as in fromJsonSchema().
function compileJsonSchema(json, options = {}) {
  return compileType(fromJsonSchema(json, options), options);
}

module.exports = {
  fromJsonSchema,
  compileJsonSchema,
};
