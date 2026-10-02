const { Schema } = require('./schema');
const { compileType } = require('./compile');
const { RefIndex, isLegacy, documentsOf } = require('./json-schema-refs');
const { UnevaluatedType } = require('./unevaluated');
const { KeywordType, KEYWORD_TYPE_TESTS } = require('./types/keyword');
const { CoerceType, COERCIBLE, coerceSpecOf } = require('./coerce');
const { FORMATS, FORMAT_COMPARES, isRfc1123Hostname } = require('./formats');

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

const DRAFTS = ['draft-04', 'draft-06', 'draft-07', '2019-09', '2020-12'];

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

// Keywords that only exist in some drafts, as annotations or checked by the code below: "id" changes the base URI in
// draft-04, as "$id" does later.
const ANNOTATIONS_04 = ['id'];
const ANNOTATIONS_2019 = ['$anchor', '$vocabulary', '$recursiveAnchor'];
const ANNOTATIONS_2020 = ['$dynamicAnchor'];

// Keywords of the later drafts that are not supported yet: they throw rather than being ignored.
const NOT_SUPPORTED_YET = [];

// Keywords that reference another schema, in each draft: "$recursiveRef" (2019-09) and "$dynamicRef" (2020-12) pick
// their target among the schema resources being evaluated (see resolveTarget()).
const REF_KEYWORDS = {
  'draft-04': ['$ref'],
  'draft-06': ['$ref'],
  'draft-07': ['$ref'],
  '2019-09': ['$ref', '$recursiveRef'],
  '2020-12': ['$ref', '$dynamicRef'],
};

// Keywords that exist only in some drafts, with the drafts that have them.
const DRAFT_KEYWORDS = {
  const: ['draft-06', 'draft-07', '2019-09', '2020-12'],
  contains: ['draft-06', 'draft-07', '2019-09', '2020-12'],
  propertyNames: ['draft-06', 'draft-07', '2019-09', '2020-12'],
  if: ['draft-07', '2019-09', '2020-12'],
  then: ['draft-07', '2019-09', '2020-12'],
  else: ['draft-07', '2019-09', '2020-12'],
  additionalItems: ['draft-04', 'draft-06', 'draft-07', '2019-09'],
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
  // Of ajv-formats: limits of the values of a format that can be compared (see formatLimitsOf()).
  formatMinimum: 'string',
  formatMaximum: 'string',
  formatExclusiveMinimum: 'string',
  formatExclusiveMaximum: 'string',
};

const FORMAT_LIMIT_KEYWORDS = ['formatMinimum', 'formatMaximum', 'formatExclusiveMinimum', 'formatExclusiveMaximum'];

const UNTYPED_KEYWORDS = [
  'type',
  'enum',
  'const',
  'anyOf',
  'oneOf',
  'not',
  'allOf',
  'if',
  'then',
  'else',
  // OpenAPI: which "oneOf" schema applies, by the value of a property (see discriminatorOf()).
  'discriminator',
];

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

// For each draft, its standard annotations and the keywords that check something (reference keywords are handled
// apart), as sets: every keyword of every node is looked up in them.
const ANNOTATIONS_OF = Object.fromEntries(
  DRAFTS.map((draft) => [
    draft,
    new Set([
      ...ANNOTATIONS,
      ...(draft === 'draft-04' ? ANNOTATIONS_04 : []),
      ...(isLegacy(draft) ? [] : ANNOTATIONS_2019),
      ...(draft === '2020-12' ? ANNOTATIONS_2020 : []),
    ]),
  ])
);
const ASSERTIONS_OF = Object.fromEntries(
  DRAFTS.map((draft) => [
    draft,
    new Set(
      [...Object.keys(TYPED_KEYWORDS), ...UNTYPED_KEYWORDS].filter(
        (keyword) => !DRAFT_KEYWORDS[keyword] || DRAFT_KEYWORDS[keyword].includes(draft)
      )
    ),
  ])
);

// Whether a keyword is an annotation in `draft`: one of the standard ones, or one the option "keywords" declares.
function isAnnotation(keyword, draft) {
  return ANNOTATIONS_OF[draft].has(keyword) || context.annotations.has(keyword);
}

// Whether a keyword checks something in `draft`: a standard one, or one of your own (the option "keywords").
function isAssertion(keyword, draft) {
  return ASSERTIONS_OF[draft].has(keyword) || context.custom.has(keyword);
}

// Whether a keyword is ignored in `draft`: an annotation, or with strict: false one that checks nothing in it (an
// unknown keyword, or one of another draft), as the JSON Schema standard reads it.
function isIgnored(keyword, draft) {
  return isAnnotation(keyword, draft) || (!context.strict && !isAssertion(keyword, draft));
}

function checkKeywords(json, path) {
  const typeNames = getTypeNames(json);
  typeNames.forEach((typeName) => {
    if (!TYPE_NAMES.includes(typeName)) {
      throw new Error(`Unsupported JSON Schema type "${typeName}" at ${path}`);
    }
  });
  // With the option "formats", a format it does not name is most likely a mistake, as in ajv's strict mode.
  if (
    context.strict &&
    context.knownFormats &&
    typeof json.format === 'string' &&
    !context.knownFormats.has(json.format)
  ) {
    throw new Error(
      `Unknown JSON Schema format "${json.format}" at ${path}: name it in the option "formats" ({ "${json.format}": false } leaves it unchecked), or use strict: false`
    );
  }
  const { draft } = context;
  Object.keys(json).forEach((keyword) => {
    if (isIgnored(keyword, draft)) {
      return;
    }
    if (NOT_SUPPORTED_YET.includes(keyword)) {
      throw new Error(`JSON Schema keyword "${keyword}" at ${path} is not supported yet`);
    }
    if (!isAssertion(keyword, draft)) {
      throw new Error(`Unsupported JSON Schema keyword "${keyword}" at ${path}`);
    }
    // Without "type" a keyword only applies to values of its type. With a "type" that excludes it, the keyword could
    // never apply, which is most likely a mistake (with strict: false it is ignored, as the standard says).
    const requiredType = TYPED_KEYWORDS[keyword];
    const isDeclared = typeNames.includes(requiredType) || (requiredType === 'number' && typeNames.includes('integer'));
    if (requiredType && context.strict && typeNames.length > 0 && !isDeclared) {
      throw new Error(`JSON Schema keyword "${keyword}" at ${path} requires "type": "${requiredType}"`);
    }
  });
}

// The draft of a schema: options.draft, or the one its "$schema" names. Without either, or with another "$schema",
// the schema is read as draft-07, as before later drafts were supported.
// The formats to check, from the option "formats": true for every built-in one, a list of built-in names, or an object
// with, for each name, true (the built-in one), a regular expression, a function, or false (a format that is known but
// not checked, as ajv's addFormat(name, true)). By name, the check: a function or a regular expression. Without the
// option, "format" is an annotation and nothing is checked.
// Also { checks, compares, known }: the comparisons of the formats whose values can be compared (the built-in date,
// time and date-time, and formats of your own given as { validate, compare }), for formatMinimum and the like; and
// with the option, the names it gives, checked or not (with strict: true another format throws).
function formatsOf(option) {
  const checks = new Map();
  const compares = new Map();
  if (option === undefined || option === false) {
    return { checks, compares, known: undefined };
  }
  const known = new Set();
  const isCheck = (check) => check instanceof RegExp || typeof check === 'function';
  const addBuiltIn = (name) => {
    if (!Object.prototype.hasOwnProperty.call(FORMATS, name)) {
      throw new Error(
        `Unsupported JSON Schema option "formats": "${name}" is not one of ${Object.keys(FORMATS).join(', ')}`
      );
    }
    checks.set(name, FORMATS[name]);
    if (FORMAT_COMPARES[name]) {
      compares.set(name, FORMAT_COMPARES[name]);
    }
  };
  if (option === true) {
    Object.keys(FORMATS).forEach(addBuiltIn);
  } else if (Array.isArray(option)) {
    option.forEach(addBuiltIn);
  } else if (option !== null && typeof option === 'object') {
    Object.entries(option).forEach(([name, check]) => {
      if (check === true) {
        addBuiltIn(name);
      } else if (isCheck(check)) {
        checks.set(name, check);
      } else if (check !== null && typeof check === 'object' && isCheck(check.validate)) {
        if (check.compare !== undefined && typeof check.compare !== 'function') {
          throw new Error(`Unsupported JSON Schema option "formats": the "compare" of "${name}" must be a function`);
        }
        checks.set(name, check.validate);
        if (check.compare) {
          compares.set(name, check.compare);
        }
      } else if (check !== false) {
        throw new Error(
          `Unsupported JSON Schema option "formats": "${name}" must be true, false, a regular expression, a function or { validate, compare }`
        );
      }
      known.add(name);
    });
  } else {
    throw new Error('Unsupported JSON Schema option "formats": expected true, a list of names or an object');
  }
  checks.forEach((check, name) => known.add(name));
  return { checks, compares, known };
}

// Every built-in format, as the option "formats" takes them ({ date: true, ... }), to add formats of your own or known
// ones left unchecked: formats: { ...builtInFormats(), int32: false }.
function builtInFormats() {
  return Object.fromEntries(Object.keys(FORMATS).map((name) => [name, true]));
}

// The limits of the value of the format of a node (formatMinimum, formatMaximum, formatExclusiveMinimum and
// formatExclusiveMaximum, of ajv-formats) as [{ keyword, limit, compare }]. As in ajv they need "format", and are
// checked only when the format is (else they are ignored, like it), which must then be one whose values can be
// compared. A limit must be a valid value of the format.
function formatLimitsOf(json, check, path) {
  return FORMAT_LIMIT_KEYWORDS.filter((keyword) => json[keyword] !== undefined).flatMap((keyword) => {
    const at = `Unsupported JSON Schema at ${path}: "${keyword}"`;
    if (json.format === undefined) {
      throw new Error(`${at} requires "format"`);
    }
    if (check === undefined) {
      return [];
    }
    const compare = context.formatCompares.get(json.format);
    if (compare === undefined) {
      throw new Error(`${at}: the values of the format "${json.format}" cannot be compared`);
    }
    const limit = json[keyword];
    const isValue = typeof limit === 'string' && (check instanceof RegExp ? check.test(limit) : check(limit));
    if (!isValue) {
      throw new Error(`${at} must be a valid ${json.format}`);
    }
    return [{ keyword, limit, compare }];
  });
}

// The format a node asks the strings to have, as options of StringType: none when "format" is not checked (the option
// "formats" does not name it, as with an unknown format, which is an annotation).
function formatOf(json, path) {
  let check = typeof json.format === 'string' ? context.formats.get(json.format) : undefined;
  // Up to draft-06 a host name follows RFC 1123 alone.
  if (check === FORMATS.hostname && (context.draft === 'draft-04' || context.draft === 'draft-06')) {
    check = isRfc1123Hostname;
  }
  const formatLimits = formatLimitsOf(json, check, path);
  return check === undefined ? {} : { format: json.format, formatCheck: check, formatLimits };
}

function draftOf(options) {
  if (options.draft !== undefined && !DRAFTS.includes(options.draft)) {
    throw new Error(`Unsupported JSON Schema option "draft": "${options.draft}" is not one of ${DRAFTS.join(', ')}`);
  }
  return options.draft;
}

// The option "useDefaults": true assigns the "default" of missing properties and tuple elements, 'empty' also the one
// of null and '' (see collectDefaults()).
function useDefaultsOf(options) {
  const { useDefaults = false } = options;
  if (useDefaults !== true && useDefaults !== false && useDefaults !== 'empty') {
    throw new Error('Unsupported JSON Schema option "useDefaults": expected true, false or \'empty\'');
  }
  return useDefaults;
}

// The option "multipleOfPrecision": a number of decimal digits; "multipleOf" then accepts a value whose division is
// within 1e-multipleOfPrecision of an integer, so 0.3 is a multiple of 0.1 (see FloatType.isMultiple()).
function multipleOfPrecisionOf(options) {
  const { multipleOfPrecision } = options;
  if (multipleOfPrecision !== undefined && !(Number.isInteger(multipleOfPrecision) && multipleOfPrecision > 0)) {
    throw new Error('Unsupported JSON Schema option "multipleOfPrecision": expected a positive integer');
  }
  return multipleOfPrecision;
}

// The option "coerceTypes": true converts values to the types "type" asks for (see coerce.js), 'array' also to and from
// arrays.
function coerceTypesOf(options) {
  const { coerceTypes = false } = options;
  if (coerceTypes !== true && coerceTypes !== false && coerceTypes !== 'array') {
    throw new Error('Unsupported JSON Schema option "coerceTypes": expected true, false or \'array\'');
  }
  return coerceTypes;
}

// The option "removeAdditional": true removes the additional properties where "additionalProperties" is false, 'all'
// every additional property of a schema with "properties" or "additionalProperties", and 'failing' also the ones that
// fail "additionalProperties" (see removalOf()).
function removeAdditionalOf(options) {
  const { removeAdditional = false } = options;
  if (![true, false, 'all', 'failing'].includes(removeAdditional)) {
    throw new Error("Unsupported JSON Schema option \"removeAdditional\": expected true, false, 'all' or 'failing'");
  }
  return removeAdditional;
}

// The option "strict": true (default) throws on unknown keywords, false ignores them.
function strictOf(options) {
  if (options.strict !== undefined && typeof options.strict !== 'boolean') {
    throw new Error('Unsupported JSON Schema option "strict": expected true or false');
  }
  return options.strict !== false;
}

// Every keyword of JSON Schema, which a keyword of your own cannot redefine.
const STANDARD_KEYWORDS = new Set([
  ...DRAFTS.flatMap((draft) => [...ANNOTATIONS_OF[draft], ...ASSERTIONS_OF[draft], ...REF_KEYWORDS[draft]]),
]);
// JSON types the definitions of macro keywords can take: the ones a WhenType tells apart.
const MACRO_TYPES = ['object', 'array', 'string', 'number'];

// A definition of a keyword of your own, checked, with its JSON types as a list (`types`, or undefined for all).
function keywordDefinitionOf(definition) {
  const at = 'Unsupported JSON Schema option "keywords":';
  if (definition === null || typeof definition !== 'object' || typeof definition.keyword !== 'string') {
    throw new Error(`${at} expected keyword names, or definitions with "keyword"`);
  }
  const { keyword, type, message } = definition;
  if (STANDARD_KEYWORDS.has(keyword)) {
    throw new Error(`${at} "${keyword}" is a keyword of JSON Schema`);
  }
  const ways = ['validate', 'compile', 'macro'].filter((way) => definition[way] !== undefined);
  if (ways.length !== 1 || typeof definition[ways[0]] !== 'function') {
    throw new Error(`${at} "${keyword}" needs one function: "validate", "compile" or "macro"`);
  }
  const types = type === undefined ? undefined : [].concat(type);
  const allowed = definition.macro ? MACRO_TYPES : Object.keys(KEYWORD_TYPE_TESTS);
  if (types !== undefined && (types.length === 0 || !types.every((name) => allowed.includes(name)))) {
    throw new Error(`${at} the "type" of "${keyword}" must be one or more of ${allowed.join(', ')}`);
  }
  if (message !== undefined && typeof message !== 'string' && typeof message !== 'function') {
    throw new Error(`${at} the "message" of "${keyword}" must be a string or a function`);
  }
  return { ...definition, types };
}

// The option "keywords": names of keywords of your own that are annotations, such as "x-internal" or "example", and
// definitions of keywords of your own that check values (see keywordDefinitionOf()).
function keywordsOf(options) {
  const { keywords = [] } = options;
  if (!Array.isArray(keywords)) {
    throw new Error('Unsupported JSON Schema option "keywords": expected a list of keyword names or definitions');
  }
  const annotations = new Set();
  const custom = new Map();
  keywords.forEach((item) => {
    if (typeof item === 'string') {
      annotations.add(item);
    } else {
      const definition = keywordDefinitionOf(item);
      custom.set(definition.keyword, definition);
    }
  });
  return { annotations, custom };
}

// The draft of a node: the one of its resource, or the one being converted for a node that is not indexed.
const draftOfNode = (json) => context.index.draftOf(json) || context.draft;

// The reference keywords of a node, in its draft.
const NO_KEYWORDS = [];
const refKeywordsOf = (json) =>
  json.$ref === undefined && json.$dynamicRef === undefined && json.$recursiveRef === undefined
    ? NO_KEYWORDS
    : REF_KEYWORDS[draftOfNode(json)].filter((keyword) => json[keyword] !== undefined);

// The keywords of a node other than its references, which later drafts apply next to them; undefined when there are
// none but ignored ones.
function besideRef(json) {
  const draft = draftOfNode(json);
  const rest = { ...json };
  REF_KEYWORDS[draft].forEach((keyword) => delete rest[keyword]);
  return Object.keys(rest).every((keyword) => isIgnored(keyword, draft)) ? undefined : rest;
}

// The node as the conversion reads it: without the keywords its vocabularies leave out and, with strict: false,
// without the keywords of other drafts, which would otherwise be read (with strict: true they throw).
function viewOf(node) {
  const view = context.index.viewOf(node);
  if (context.strict) {
    return view;
  }
  const draft = draftOfNode(node);
  const isOther = (keyword) => DRAFT_KEYWORDS[keyword] !== undefined && !DRAFT_KEYWORDS[keyword].includes(draft);
  if (!Object.keys(view).some(isOther)) {
    return view;
  }
  if (!context.views.has(node)) {
    context.views.set(node, Object.fromEntries(Object.entries(view).filter(([keyword]) => !isOther(keyword))));
  }
  return context.views.get(node);
}

// Dynamic scope: the schema resources being evaluated, from the outermost. What dynamic references need of it is,
// for each dynamic anchor name, the outermost resource that declares it; a scope holds that, with a key naming it.
// Scopes only grow, and there are few of them, so each schema is converted once for each scope it is reached in.
// A scope also remembers the scope entering each resource gives (`next`), so that is worked out once.
const newScope = (key, anchors) => ({ key, anchors, next: new Map() });

// The scope after entering the resource `uri` (undefined for a node that is not indexed, which changes nothing).
// Without dynamic anchors in the schema, the scope never changes.
function enter(scope, uri) {
  if (uri === undefined) {
    return scope;
  }
  if (!scope.next.has(uri)) {
    const added = [...context.index.dynamicAnchorsOf(uri).keys()].filter((name) => !scope.anchors.has(name));
    if (added.length === 0) {
      scope.next.set(uri, scope);
    } else {
      const anchors = new Map(scope.anchors);
      added.forEach((name) => anchors.set(name, uri));
      const key = [...anchors].map(([name, resource]) => `${name}=${resource}`).join('\n');
      // Scopes with the same anchors are the same scope, whichever way they were reached.
      if (!context.scopes.has(key)) {
        context.scopes.set(key, newScope(key, anchors));
      }
      scope.next.set(uri, context.scopes.get(key));
    }
  }
  return scope.next.get(uri);
}

// The scope after entering the resource of `node`. Without dynamic anchors in the schema, the scope never changes, and
// the resource is not looked up.
const enterNode = (scope, node) =>
  context.index.dynamicAnchors.size === 0 ? scope : enter(scope, context.index.resourceOf(node));

// The name of the anchor a reference points to ("#name" or "uri#name"), or undefined for a JSON pointer or none.
function anchorName(ref) {
  const index = ref.indexOf('#');
  if (index === -1) {
    return undefined;
  }
  const name = ref.slice(index + 1);
  if (name === '' || name.startsWith('/')) {
    return undefined;
  }
  try {
    return decodeURIComponent(name);
  } catch (e) {
    return undefined;
  }
}

// The schema node a reference keyword of `json` points to in `scope`, or undefined when it does not resolve. A
// "$dynamicRef" that first resolves to a "$dynamicAnchor" of the same name, or a "$recursiveRef" that first resolves
// to a resource with "$recursiveAnchor": true, points to the outermost resource of the scope with that anchor.
function resolveTarget(json, keyword, scope) {
  const { index } = context;
  if (keyword === '$ref') {
    return index.resolve(json);
  }
  const initial = index.resolve(json, keyword === '$recursiveRef' ? '#' : json[keyword]);
  const isObject = initial !== null && typeof initial === 'object';
  let name;
  if (keyword === '$dynamicRef') {
    name = anchorName(json.$dynamicRef);
    if (name === undefined || !isObject || initial.$dynamicAnchor !== name) {
      return initial;
    }
  } else {
    name = '';
    if (!isObject || initial.$recursiveAnchor !== true) {
      return initial;
    }
  }
  const resource = scope.anchors.get(name);
  return resource === undefined ? initial : index.dynamicAnchorsOf(resource).get(name);
}

// The keywords of your own a node has.
const customKeywordsOf = (json) =>
  context.custom.size === 0 ? NO_KEYWORDS : Object.keys(json).filter((keyword) => context.custom.has(keyword));

// What a keyword of your own gives for a node (`json` is its view), worked out once: the schema its macro returns, or
// the function checking a value, from "compile" or "validate".
function customPartOf(node, json, keyword) {
  if (!context.customParts.has(node)) {
    context.customParts.set(node, new Map());
  }
  const parts = context.customParts.get(node);
  if (!parts.has(keyword)) {
    const definition = context.custom.get(keyword);
    const value = json[keyword];
    const it = { draft: context.draft };
    let part;
    if (definition.macro) {
      part = definition.macro(value, json, it);
    } else if (definition.compile) {
      part = definition.compile(value, json, it);
      if (typeof part !== 'function' && !(part instanceof RegExp)) {
        throw new Error(
          `Unsupported JSON Schema: the "compile" of keyword "${keyword}" must return a function or a regular expression`
        );
      }
    } else {
      part = (data) => definition.validate(value, data, json);
    }
    parts.set(keyword, part);
  }
  return parts.get(keyword);
}

// null is valid only if every constraint of the node accepts it. `seen` stops at reference cycles, which give no
// value that accepts null.
function acceptsNull(json, seen = new Set(), outerScope = context.scope) {
  if (json === true) {
    return true;
  }
  if (json === false || json === null || typeof json !== 'object') {
    return false;
  }
  // The node is checked in the scope of its resource, like convert() converts it, and as its vocabularies see it.
  const scope = enterNode(outerScope, json);
  const view = viewOf(json);
  const refKeywords = refKeywordsOf(json);
  if (refKeywords.length > 0) {
    if (seen.has(json)) {
      return false;
    }
    // `seen` holds the references being followed, so a target reached again through another path is not a cycle.
    seen.add(json);
    // Up to draft-07 only "$ref" counts, and the keywords next to it are ignored.
    const followed = isLegacy(draftOfNode(json)) ? ['$ref'] : refKeywords;
    const result = followed.every((keyword) => {
      const target = resolveTarget(json, keyword, scope);
      return target !== undefined && acceptsNull(target, seen, scope);
    });
    seen.delete(json);
    const rest = isLegacy(draftOfNode(json)) ? undefined : besideRef(view);
    return result && (rest === undefined || acceptsNull(rest, seen, scope));
  }
  if (view.nullable === true) {
    return true;
  }
  const checks = [];
  if (view.type !== undefined) {
    checks.push(getTypeNames(view).includes('null'));
  }
  if (view.enum) {
    checks.push(view.enum.includes(null));
  }
  if ('const' in view) {
    checks.push(view.const === null);
  }
  if (view.anyOf) {
    checks.push(view.anyOf.some((item) => acceptsNull(item, seen, scope)));
  }
  if (view.oneOf) {
    checks.push(view.oneOf.filter((item) => acceptsNull(item, seen, scope)).length === 1);
  }
  if (view.not !== undefined) {
    checks.push(!acceptsNull(view.not, seen, scope));
  }
  if (view.allOf) {
    checks.push(view.allOf.every((item) => acceptsNull(item, seen, scope)));
  }
  if (view.if !== undefined) {
    const branch = acceptsNull(view.if, seen, scope) ? view.then : view.else;
    checks.push(branch === undefined || acceptsNull(branch, seen, scope));
  }
  // Keywords of your own that check null: the schema of a macro, or the check itself.
  customKeywordsOf(view).forEach((keyword) => {
    const definition = context.custom.get(keyword);
    if (definition.types === undefined || definition.types.includes('null')) {
      const part = customPartOf(json, view, keyword);
      checks.push(definition.macro ? acceptsNull(part, seen, scope) : Boolean(part(null)));
    }
  });
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

// With useDefaults, the defaults of the schemas `items` (the "properties" of an object, by key, or the positions of a
// tuple) as [{ key, value, empty }]. As in ajv, defaults inside "anyOf", "oneOf", "not" and "if" (directly or through
// "$ref") are not assigned, as those schemas may not apply: with strict: true they throw.
function collectDefaults(items, keys, path) {
  if (!context.useDefaults) {
    return [];
  }
  const empty = context.useDefaults === 'empty';
  return keys
    .filter((key) => {
      const item = items[key];
      return item !== null && typeof item === 'object' && !Array.isArray(item) && item.default !== undefined;
    })
    .filter((key) => {
      if (context.composite === 0) {
        return true;
      }
      if (context.strict) {
        throw new Error(
          `Unsupported JSON Schema at ${path}: "default" of "${key}" is ignored inside "anyOf", "oneOf", "not" and "if" (useDefaults); use strict: false to ignore it`
        );
      }
      return false;
    })
    .map((key) => {
      if (key === '__proto__') {
        throw new Error(`Unsupported JSON Schema at ${path}: "default" of "__proto__" (useDefaults)`);
      }
      return { key, value: items[key].default, empty };
    });
}

// What removeAdditional does with the additional properties of an object schema: 'delete' them all, delete the
// 'failing' ones, or nothing (undefined), as in ajv.
function removalOf(json) {
  const mode = context.removeAdditional;
  const { additionalProperties } = json;
  if (mode === 'all' && (json.properties !== undefined || additionalProperties !== undefined)) {
    return 'delete';
  }
  if (mode && additionalProperties === false) {
    return 'delete';
  }
  const isSchema = additionalProperties !== null && typeof additionalProperties === 'object';
  return mode === 'failing' && isSchema ? 'failing' : undefined;
}

// Converts the schemas of a keyword that may not apply ("anyOf", "oneOf", "not" and "if"), where defaults are not
// assigned.
function inComposite(convertIt) {
  context.composite += 1;
  try {
    return convertIt();
  } finally {
    context.composite -= 1;
  }
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
  const patternProperties = json.patternProperties || {};
  const patternTypes = Object.keys(patternProperties).map((source) => ({
    pattern: new RegExp(source, 'u'),
    type: convert(patternProperties[source], `${path}.patternProperties.${source}`),
  }));
  // A key only "required" names must be present; its value is an additional property unless a pattern matches it, so
  // it satisfies "additionalProperties" (with false, the object is never valid).
  // With removeAdditional, it only has to be present, as in ajv, which checks "required" before removing the
  // additional properties: the key is then checked, and maybe removed, as one of them.
  const removal = removalOf(json);
  required
    .filter((key) => !Object.prototype.hasOwnProperty.call(definition, key))
    .forEach((key) => {
      const isAdditional =
        !removal && additionalProperties !== undefined && !patternTypes.some(({ pattern }) => pattern.test(key));
      definition[key] = isAdditional
        ? convert(additionalProperties, `${path}.additionalProperties`)
        : new AnyType({ isNullable: true });
    });
  const schema = new Schema(definition, {
    isOpen: additionalProperties !== false,
    additionalType,
    patternTypes,
    dependencies: convertDependencies(json, path),
    propertyNameType:
      json.propertyNames === undefined ? undefined : convert(json.propertyNames, `${path}.propertyNames`),
    minProperties: json.minProperties,
    maxProperties: json.maxProperties,
    defaults: collectDefaults(properties, Object.keys(properties), `${path}.properties`),
    removeAdditional: removal,
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
  // The positions of the tuple, whose defaults useDefaults assigns.
  let tupleItems = Array.isArray(items) && context.draft !== '2020-12' ? items : undefined;
  if (context.draft === '2020-12' && Array.isArray(json.prefixItems)) {
    tupleItems = json.prefixItems;
  }
  const array = new ArrayOfType({
    defaults: tupleItems
      ? collectDefaults(
          tupleItems,
          tupleItems.map((item, i) => i),
          path
        )
      : [],
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
  // In draft-04 "exclusiveMinimum" and "exclusiveMaximum" are booleans that make "minimum" and "maximum" exclusive.
  const isDraft04 = context.draft === 'draft-04';
  ['exclusiveMinimum', 'exclusiveMaximum'].forEach((keyword) => {
    const expected = isDraft04 ? 'boolean' : 'number';
    const actual = typeof json[keyword];
    if (json[keyword] !== undefined && actual !== expected) {
      throw new Error(`Unsupported JSON Schema at ${path}: "${keyword}" must be a ${expected} in ${context.draft}`);
    }
  });
  if (isDraft04) {
    return new Type({
      min: json.exclusiveMinimum === true ? undefined : json.minimum,
      max: json.exclusiveMaximum === true ? undefined : json.maximum,
      exclusiveMin: json.exclusiveMinimum === true ? json.minimum : undefined,
      exclusiveMax: json.exclusiveMaximum === true ? json.maximum : undefined,
      multipleOf: json.multipleOf,
      multipleOfPrecision: context.multipleOfPrecision,
    });
  }
  return new Type({
    min: json.minimum,
    max: json.maximum,
    exclusiveMin: json.exclusiveMinimum,
    exclusiveMax: json.exclusiveMaximum,
    multipleOf: json.multipleOf,
    multipleOfPrecision: context.multipleOfPrecision,
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
        ...formatOf(json, path),
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
  return jsonTypes.map(
    (jsonType) =>
      new WhenType({
        jsonType,
        type: asInner(convertTypeName(jsonType, json, path)),
      })
  );
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

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The schemas a "oneOf" schema stands for: itself and, while it only references another one, the schemas its "$ref"
// leads to. The last one has the properties.
function referencedSchemas(item) {
  const schemas = [];
  let schema = item;
  while (isObject(schema) && !schemas.includes(schema)) {
    schemas.push(schema);
    if (typeof schema.$ref !== 'string' || schema.properties !== undefined) {
      break;
    }
    schema = context.index.resolve(schema);
  }
  return schemas;
}

// The values a schema gives the property `tag` with "const" or "enum", or undefined when it gives none.
function tagValuesOf(schema, tag) {
  const property = isObject(schema) && isObject(schema.properties) ? schema.properties[tag] : undefined;
  if (!isObject(property)) {
    return undefined;
  }
  if ('const' in property) {
    return [property.const];
  }
  return Array.isArray(property.enum) ? property.enum : undefined;
}

// The name of a "oneOf" schema that is a reference, for the implicit mapping of OpenAPI: the last token of the JSON
// pointer of its "$ref" ("Dog" for "#/components/schemas/Dog"). Undefined for other schemas.
function schemaNameOf(item) {
  if (!isObject(item) || typeof item.$ref !== 'string') {
    return undefined;
  }
  const hash = item.$ref.indexOf('#');
  const pointer = hash === -1 ? '' : item.$ref.slice(hash + 1);
  if (!pointer.startsWith('/')) {
    return undefined;
  }
  try {
    const token = decodeURIComponent(pointer.slice(pointer.lastIndexOf('/') + 1));
    return token.replace(/~1/g, '/').replace(/~0/g, '~') || undefined;
  } catch (e) {
    return undefined;
  }
}

// The "discriminator" of a node (OpenAPI): the property ("propertyName") whose value picks the "oneOf" schema that
// applies. The value of each schema comes from, in this order:
// - "mapping": values to references (resolved against the node) or to schema names, as in OpenAPI;
// - a "const" or "enum" that the schema (or the schema it references) gives the property, as ajv reads it;
// - else the implicit mapping of OpenAPI: the name of the schema it references ("Dog" for "#/components/schemas/Dog").
// The values must be unique strings, and the property required by the node or by every schema. Objects are then
// checked only against the schema their value picks. With values from "const" and "enum" alone, no other schema
// accepts that value, so the result is the one of "oneOf" (`exact`); a "mapping" or a name picks the schema as OpenAPI
// does, whatever the other schemas accept. Returns { tag, mapping, exact }, with the index of the schema for each
// value.
function discriminatorOf(json, path) {
  const { discriminator } = json;
  const at = `Unsupported JSON Schema at ${path}: "discriminator"`;
  if (!isObject(discriminator) || typeof discriminator.propertyName !== 'string') {
    throw new Error(`${at} requires "propertyName"`);
  }
  const tag = discriminator.propertyName;
  if (discriminator.mapping !== undefined && !isObject(discriminator.mapping)) {
    throw new Error(`${at}: "mapping" must be an object of references or schema names by value`);
  }
  const branches = json.oneOf.map((item) => ({ schemas: referencedSchemas(item), name: schemaNameOf(item) }));
  const mapping = new Map();
  let exact = true;
  const add = (value, i) => {
    if (typeof value !== 'string' || mapping.has(value)) {
      throw new Error(`${at}: the values of "${tag}" must be unique strings`);
    }
    mapping.set(value, i);
  };
  // Values of "mapping", by the schema their reference leads to, or by schema name.
  Object.entries(discriminator.mapping || {}).forEach(([value, target]) => {
    if (typeof target !== 'string') {
      throw new Error(`${at}: "mapping"."${value}" must be a reference or a schema name`);
    }
    const isName = !target.includes('#') && !target.includes('/');
    const node = isName ? undefined : context.index.resolve(json, target);
    const i = branches.findIndex(({ schemas, name }) => (isName ? name === target : schemas.includes(node)));
    if (i === -1) {
      throw new Error(`${at}: "mapping"."${value}" ("${target}") is not one of the "oneOf" schemas`);
    }
    add(value, i);
    exact = false;
  });
  let requiredByAll = true;
  branches.forEach(({ schemas, name }, i) => {
    const schema = schemas[schemas.length - 1];
    const values = tagValuesOf(schema, tag);
    if (values !== undefined) {
      values.forEach((value) => add(value, i));
    } else if (![...mapping.values()].includes(i)) {
      if (name === undefined) {
        throw new Error(
          `${at}: every "oneOf" schema needs a value of "${tag}": a "const" or "enum" in "properties"."${tag}", an entry of "mapping", or a "$ref" to a schema named as the value`
        );
      }
      add(name, i);
      exact = false;
    }
    requiredByAll = requiredByAll && Array.isArray(schema.required) && schema.required.includes(tag);
  });
  if (!requiredByAll && !(Array.isArray(json.required) && json.required.includes(tag))) {
    throw new Error(`${at}: "${tag}" must be required`);
  }
  return { tag, mapping, exact };
}

// A "oneOf" without "discriminator" whose schemas give one property distinct string values with "const" or "enum":
// objects are checked against the schema their value picks, as with a discriminator, since no other schema accepts
// that value. A value that picks none is checked as by "oneOf", with the same errors, so the result and the errors are
// the ones of "oneOf" but for the errors of an object whose value picks a schema, which are the ones of that schema.
// Returns { tag, mapping, exact: true, auto: true }, or undefined when no property does it.
function implicitDiscriminatorOf(json) {
  if (json.oneOf.length < 2) {
    return undefined;
  }
  const schemas = json.oneOf.map((item) => {
    const chain = referencedSchemas(item);
    return chain[chain.length - 1];
  });
  const first = schemas[0];
  const candidates = isObject(first) && isObject(first.properties) ? Object.keys(first.properties) : [];
  for (let c = 0; c < candidates.length; c += 1) {
    const tag = candidates[c];
    const mapping = new Map();
    const isTag = schemas.every((schema, i) => {
      const values = tagValuesOf(schema, tag);
      return (
        values !== undefined &&
        values.length > 0 &&
        values.every((value) => typeof value === 'string' && !mapping.has(value) && mapping.set(value, i))
      );
    });
    if (isTag) {
      return { tag, mapping, exact: true, auto: true };
    }
  }
  return undefined;
}

// The types checking the keywords of your own of a node. A macro is replaced by the schema it returns, which only
// applies to the values of its JSON types when it has them.
function convertCustom(node, json, path) {
  return customKeywordsOf(json).flatMap((keyword) => {
    const definition = context.custom.get(keyword);
    const part = customPartOf(node, json, keyword);
    if (definition.macro) {
      const type = convert(part, `${path}.${keyword}`);
      if (definition.types === undefined) {
        return [type];
      }
      return definition.types.map((jsonType) => new WhenType({ jsonType, type: asInner(type) }));
    }
    const value = json[keyword];
    let { message } = definition;
    if (typeof message === 'function' && message.length < 2) {
      // It does not take the data: its text is the same for every value.
      message = message(value);
    } else if (typeof message === 'function') {
      const text = message;
      message = (data) => text(value, data);
    } else if (message === undefined) {
      message = `must pass the "${keyword}" keyword`;
    }
    // Named for the error of standalone code, which cannot contain them.
    [part, message]
      .filter((fn) => typeof fn === 'function')
      .forEach((fn) => {
        fn.schivaKeyword = keyword;
      });
    return [
      new KeywordType({
        keyword,
        check: part,
        message,
        jsonTypes: definition.types,
        isMandatory: false,
        isNullable: true,
      }),
    ];
  });
}

let convertNode;

// Converts a node within the scope of the resource it belongs to, which the nodes below it are converted in too.
convert = (json, path, isMandatory = true) => {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return convertNode(json, path, isMandatory);
  }
  const { scope, draft } = context;
  context.scope = enterNode(scope, json);
  // A resource that names another draft with "$schema" is converted in it.
  context.draft = context.index.draftOf(json) || draft;
  try {
    return convertNode(json, path, isMandatory);
  } finally {
    context.scope = scope;
    context.draft = draft;
  }
};

convertNode = (node, path, isMandatory) => {
  if (node === true) {
    return new AnyType({ isMandatory, isNullable: true });
  }
  if (node === false) {
    return new NeverType({ isMandatory, isNullable: false });
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error(`Unsupported JSON Schema at ${path}: expected an object or a boolean`);
  }
  // The keywords its vocabularies leave out are ignored; references resolve from the node itself.
  const json = viewOf(node);
  // Up to draft-07 every keyword next to "$ref" is ignored; later drafts apply them too.
  let refKeywords = NO_KEYWORDS;
  if (!isLegacy(context.draft)) {
    refKeywords = refKeywordsOf(json);
  } else if (json.$ref !== undefined) {
    refKeywords = ['$ref'];
  }
  if (refKeywords.length > 0) {
    const refs = refKeywords.map((keyword) => {
      if (typeof json[keyword] !== 'string') {
        throw new Error(`Unsupported JSON Schema at ${path}: "${keyword}" must be a string`);
      }
      if (keyword === '$recursiveRef' && json.$recursiveRef !== '#') {
        throw new Error(`Unsupported JSON Schema at ${path}: "$recursiveRef" must be "#"`);
      }
      const ref = new RefType({
        ref: json[keyword],
        isMandatory,
        isNullable: true,
      });
      // Resolved later, in the scope of this node.
      context.pending.push({
        ref,
        json: node,
        keyword,
        path,
        scope: context.scope,
        composite: context.composite,
      });
      return ref;
    });
    const rest = isLegacy(context.draft) ? undefined : besideRef(json);
    if (rest === undefined && refs.length === 1) {
      return refs[0];
    }
    // The references count as keywords that evaluate properties and elements for "unevaluated*".
    const { unevaluatedProperties, unevaluatedItems, ...others } = rest || {};
    const parts = [...refs];
    if (rest !== undefined && besideRef(others) !== undefined) {
      parts.push(convertNode(others, path, true));
    }
    addUnevaluated(parts, json, path);
    const type = new AllOfType({ types: parts.map(asInner) });
    type.isMandatory = isMandatory;
    type.isNullable = acceptsNull(node);
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
  // A checked "format" of a schema without "type" applies to strings, like the keywords of each type (unless one of
  // them gave a string type, which has it).
  const hasStringKeyword = Object.keys(json).some((keyword) => TYPED_KEYWORDS[keyword] === 'string');
  if (namesToConvert.length === 0 && !hasStringKeyword && formatOf(json, path).format !== undefined) {
    constraints.push(
      new WhenType({
        jsonType: 'string',
        type: asInner(new StringType(formatOf(json, path))),
      })
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
        inComposite(() => json.anyOf.map((item, i) => convert(item, `${path}.anyOf[${i}]`))),
        AnyOfType
      )
    );
  }
  if (json.oneOf) {
    if (!Array.isArray(json.oneOf) || json.oneOf.length === 0) {
      throw new Error(`Unsupported JSON Schema at ${path}: "oneOf" must be a non-empty array`);
    }
    const types = inComposite(() => json.oneOf.map((item, i) => asInner(convert(item, `${path}.oneOf[${i}]`))));
    const discriminator =
      json.discriminator === undefined ? implicitDiscriminatorOf(json) : discriminatorOf(json, path);
    constraints.push(new OneOfType({ types, discriminator }));
  } else if (json.discriminator !== undefined) {
    throw new Error(`Unsupported JSON Schema at ${path}: "discriminator" requires "oneOf"`);
  }
  if (json.not !== undefined) {
    constraints.push(new NotType({ type: asInner(inComposite(() => convert(json.not, `${path}.not`))) }));
  }
  if (json.allOf) {
    json.allOf.forEach((item, i) => constraints.push(convert(item, `${path}.allOf[${i}]`)));
  }
  // "then" and "else" are ignored without "if", and "if" alone checks nothing. From draft 2019-09 on it is kept even
  // alone, as what it evaluates counts for an "unevaluated*" of this node or of one that refers to it.
  const keepsIf = json.then !== undefined || json.else !== undefined || !isLegacy(context.draft);
  if (json.if !== undefined && keepsIf) {
    const branch = (keyword) =>
      json[keyword] === undefined ? undefined : asInner(convert(json[keyword], `${path}.${keyword}`));
    constraints.push(
      new ConditionalType({
        ifType: asInner(inComposite(() => convert(json.if, `${path}.if`))),
        thenType: branch('then'),
        elseType: branch('else'),
      })
    );
  }
  constraints.push(...convertCustom(node, json, path));
  addUnevaluated(constraints, json, path);
  const type = combine(constraints, AllOfType);
  type.isMandatory = isMandatory;
  type.isNullable = acceptsNull(node);
  // With coerceTypes, the value is converted to its types where it is read (see coerce.js). "nullable": true adds
  // null to them, as in ajv: null is kept (not converted to '' or 0), and '', 0 and false may become null.
  const coerceTypes =
    json.nullable === true && typeNames.length > 0 && !typeNames.includes('null') ? [...typeNames, 'null'] : typeNames;
  const coerceTo = coerceTypes.filter(
    (typeName) => COERCIBLE.includes(typeName) || (typeName === 'array' && context.coerceTypes === 'array')
  );
  if (context.coerceTypes && coerceTo.length > 0) {
    type.coerceSpec = { types: coerceTypes, to: coerceTo, array: context.coerceTypes === 'array' };
  }
  return type;
};

// Points every reference to the type of its target, converting each target once. Converting a target can add
// references, which the loop resolves too.
function resolveReferences() {
  while (context.pending.length > 0) {
    const { ref, json, keyword, path, scope, composite } = context.pending.shift();
    const target = resolveTarget(json, keyword, scope);
    if (target === undefined) {
      const error = new Error(
        `Unsupported JSON Schema "${keyword}": "${json[keyword]}" at ${path}: only references within the schema or to documents in the "schemas" option are supported`
      );
      // The document to load for the reference to resolve, which loadJsonSchemas() asks loadSchema for.
      error.missingSchema = context.index.missingDocument(json, keyword === '$recursiveRef' ? '#' : json[keyword]);
      throw error;
    }
    // A target is converted once for each scope it is reached in, as dynamic references in it may resolve
    // differently.
    const targetScope = enterNode(scope, target);
    if (!context.targets.has(target)) {
      context.targets.set(target, new Map());
    }
    const byScope = context.targets.get(target);
    // With useDefaults, a target reached inside "anyOf", "oneOf", "not" or "if" is converted apart, without defaults.
    const key = context.useDefaults && composite > 0 ? `${targetScope.key}\n(composite)` : targetScope.key;
    if (!byScope.has(key)) {
      context.scope = targetScope;
      context.composite = composite;
      byScope.set(key, convert(target, json[keyword]));
      context.composite = 0;
    }
    ref.target = byScope.get(key);
  }
}

// Builds a validation type from a JSON Schema (draft-07, 2019-09 or 2020-12: see draftOf()). Throws on unsupported
// keywords instead of silently ignoring them. "$ref" can point within the schema or to the documents in
// options.schemas, given as { uri: schema } or as an array of schemas with "$id"; they are only converted where
// referenced.
function fromJsonSchema(json, options = {}) {
  const strict = strictOf(options);
  const { annotations, custom } = keywordsOf(options);
  const useDefaults = useDefaultsOf(options);
  const coerceTypes = coerceTypesOf(options);
  const multipleOfPrecision = multipleOfPrecisionOf(options);
  const formats = formatsOf(options.formats);
  const removeAdditional = removeAdditionalOf(options);
  const index = new RefIndex(json, options.schemas, draftOf(options));
  // The scope before entering any resource. Scopes belong to one conversion, as they remember what follows them.
  const emptyScope = newScope('', new Map());
  context = {
    draft: index.draft,
    index,
    // Target node to the type converted for it, by the key of the scope it was converted in.
    targets: new Map(),
    pending: [],
    // Scopes by key, so the same anchors give the same scope.
    scopes: new Map([['', emptyScope]]),
    // The formats checked, by name (see formatsOf()).
    formats: formats.checks,
    // The comparisons of the formats whose values can be compared (see formatLimitsOf()).
    formatCompares: formats.compares,
    // With the option "formats", the names it gives (see checkKeywords()).
    knownFormats: formats.known,
    scope: emptyScope,
    // Options "strict" and "keywords" (see isIgnored()), and the nodes without the keywords of other drafts (viewOf()).
    strict,
    annotations,
    custom,
    views: new Map(),
    // What the keywords of your own give for each node, by keyword: the schema of a macro, or the check.
    customParts: new Map(),
    // Options "useDefaults" and "removeAdditional", and how many "anyOf", "oneOf", "not" or "if" the node being
    // converted is inside (see collectDefaults()).
    useDefaults,
    removeAdditional,
    composite: 0,
    // Option "coerceTypes" (see coerce.js).
    coerceTypes,
    // Option "multipleOfPrecision" (see FloatType.isMultiple()).
    multipleOfPrecision,
  };
  try {
    const type = convert(json, '#');
    const rootScope = enterNode(emptyScope, json);
    context.targets.set(json, new Map([[rootScope.key, type]]));
    resolveReferences();
    // The value validated is in no object or array: with coerceTypes, it is converted for the validation only.
    const spec = coerceTypes ? coerceSpecOf(type) : undefined;
    return spec ? new CoerceType({ type, spec }) : type;
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

// The documents a schema references that options.schemas does not have, loaded with options.loadSchema(uri), an
// async function giving the schema at an absolute URI (without fragment). Only the documents the conversion reaches
// are loaded, one at a time, including the ones they reference in turn. Resolves to options.schemas with them added,
// as an object of schemas by URI, for compileJsonSchema() or standaloneJsonSchema().
async function loadJsonSchemas(json, options = {}) {
  if (typeof options.loadSchema !== 'function') {
    throw new Error('Unsupported JSON Schema option "loadSchema": expected an async function (uri) => schema');
  }
  const schemas = Object.fromEntries(documentsOf(options.schemas).map(({ uri, schema }) => [uri, schema]));
  const loaded = new Set();
  for (;;) {
    try {
      fromJsonSchema(json, { ...options, schemas });
      return schemas;
    } catch (e) {
      const uri = e.missingSchema;
      if (uri === undefined || loaded.has(uri)) {
        throw e;
      }
      loaded.add(uri);
      // One document at a time: the next conversion tells which one is missing next.
      // eslint-disable-next-line no-await-in-loop
      schemas[uri] = await options.loadSchema(uri);
    }
  }
}

// compileJsonSchema() for a schema referencing documents to load first with options.loadSchema (see loadJsonSchemas()),
// like ajv's compileAsync().
async function compileJsonSchemaAsync(json, options = {}) {
  const schemas = await loadJsonSchemas(json, options);
  return compileJsonSchema(json, { ...options, schemas });
}

module.exports = {
  fromJsonSchema,
  compileJsonSchema,
  loadJsonSchemas,
  compileJsonSchemaAsync,
  builtInFormats,
};
