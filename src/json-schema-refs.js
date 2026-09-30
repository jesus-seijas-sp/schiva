// Resolution of JSON Schema references: JSON pointers ("#/definitions/a"), "$id" base URI changes, and anchors ("#foo":
// "$id" fragments, and from draft 2019-09 on "$anchor" and "$dynamicAnchor"), within the schema and within other
// documents registered by URI. Nothing is loaded from the network: a reference to a document that is not registered
// does not resolve. It also records the dynamic anchors of each resource ("$dynamicAnchor", and "$recursiveAnchor": true
// on a resource root as an anchor without name), which dynamic references look up in the resources being evaluated.

// Base URI of a document without "$id".
const DEFAULT_BASE = 'schiva://schema/root.json';

// Keywords whose value is a subschema, a map of subschemas or a list of subschemas, where "$id" can appear.
const SCHEMA_KEYWORDS = [
  'additionalItems',
  'additionalProperties',
  'contains',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'contentSchema',
  'unevaluatedItems',
  'unevaluatedProperties',
];
const SCHEMA_MAP_KEYWORDS = [
  'definitions',
  '$defs',
  'dependencies',
  'dependentSchemas',
  'patternProperties',
  'properties',
];
const SCHEMA_LIST_KEYWORDS = ['allOf', 'anyOf', 'items', 'oneOf', 'prefixItems'];

// Drafts where every keyword next to "$ref" is ignored, "$id" included.
const LEGACY_DRAFTS = ['draft-04', 'draft-06', 'draft-07'];
const isLegacy = (draft) => LEGACY_DRAFTS.includes(draft);

// The keyword that changes the base URI: "id" in draft-04, "$id" later.
const idKeyword = (draft) => (draft === 'draft-04' ? 'id' : '$id');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function resolveUri(ref, base) {
  try {
    return new URL(ref, base).href;
  } catch (e) {
    return undefined;
  }
}

function splitFragment(uri) {
  const index = uri.indexOf('#');
  return index === -1 ? [uri, ''] : [uri.slice(0, index), uri.slice(index + 1)];
}

function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch (e) {
    return undefined;
  }
}

// Follows a JSON pointer ("/a/b~1c/0") from a node; undefined when a token is missing.
function followPointer(node, pointer) {
  const tokens = pointer
    .split('/')
    .slice(1)
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = node;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (Array.isArray(current) && /^(0|[1-9][0-9]*)$/.test(token)) {
      current = current[Number(token)];
    } else if (current !== null && typeof current === 'object' && !Array.isArray(current) && hasOwn(current, token)) {
      current = current[token];
    } else {
      return undefined;
    }
  }
  return current;
}

// Documents to register, from { uri: schema } or [schema with "$id"], without a fragment other than an empty one
// ("http://json-schema.org/draft-07/schema#"). A relative URI ("address", as Fastify and ajv allow) is resolved against
// the base URI of a schema without "$id", so "$ref": "address#" in such a schema reaches it.
function documentsOf(schemas) {
  if (schemas === undefined) {
    return [];
  }
  let entries;
  if (Array.isArray(schemas)) {
    entries = schemas.map((schema) => [schema && (typeof schema.$id === 'string' ? schema.$id : schema.id), schema]);
  } else if (isObject(schemas)) {
    entries = Object.entries(schemas);
  } else {
    throw new Error('Unsupported JSON Schema option "schemas": expected an object of schemas by URI or an array');
  }
  return entries.map(([uri, schema]) => {
    const absolute = typeof uri === 'string' && uri !== '' ? resolveUri(uri, DEFAULT_BASE) : undefined;
    const [document, fragment] = absolute === undefined ? [] : splitFragment(absolute);
    if (absolute === undefined || fragment !== '') {
      throw new Error(`Unsupported JSON Schema option "schemas": "${uri}" is not a URI without fragment`);
    }
    return { uri: document, schema };
  });
}

// Drafts by the "$schema" URI (without its empty fragment) that selects them.
const DRAFT_URIS = {
  'http://json-schema.org/draft-04/schema': 'draft-04',
  'https://json-schema.org/draft-04/schema': 'draft-04',
  'http://json-schema.org/draft-06/schema': 'draft-06',
  'https://json-schema.org/draft-06/schema': 'draft-06',
  'http://json-schema.org/draft-07/schema': 'draft-07',
  'https://json-schema.org/draft-07/schema': 'draft-07',
  'https://json-schema.org/draft/2019-09/schema': '2019-09',
  'http://json-schema.org/draft/2019-09/schema': '2019-09',
  'https://json-schema.org/draft/2020-12/schema': '2020-12',
  'http://json-schema.org/draft/2020-12/schema': '2020-12',
};

// The draft a "$schema" names, or undefined.
function draftOfUri(uri) {
  return typeof uri === 'string' ? DRAFT_URIS[uri.replace(/#$/, '')] : undefined;
}

// Keywords of the vocabularies of drafts 2019-09 and 2020-12 that a meta-schema can leave out with "$vocabulary".
// The others (core, meta-data, format, content) always apply or are annotations.
const VOCABULARY_KEYWORDS = {
  validation: [
    'type',
    'enum',
    'const',
    'multipleOf',
    'maximum',
    'exclusiveMaximum',
    'minimum',
    'exclusiveMinimum',
    'maxLength',
    'minLength',
    'pattern',
    'maxItems',
    'minItems',
    'uniqueItems',
    'maxContains',
    'minContains',
    'maxProperties',
    'minProperties',
    'required',
    'dependentRequired',
  ],
  applicator: [
    'prefixItems',
    'items',
    'additionalItems',
    'contains',
    'additionalProperties',
    'properties',
    'patternProperties',
    'dependentSchemas',
    'propertyNames',
    'if',
    'then',
    'else',
    'allOf',
    'anyOf',
    'oneOf',
    'not',
  ],
  unevaluated: ['unevaluatedItems', 'unevaluatedProperties'],
};
const KNOWN_VOCABULARIES = [
  'core',
  'applicator',
  'unevaluated',
  'validation',
  'meta-data',
  'format',
  'format-annotation',
  'format-assertion',
  'content',
];

// The keywords a "$vocabulary" of `draft` leaves out: the ones of the vocabularies it does not list. In 2019-09 the
// unevaluated keywords belong to the applicator vocabulary. An unknown vocabulary is ignored when it is optional
// (false), and throws when it is required.
function ignoredKeywords(vocabulary, draft) {
  const prefix = `https://json-schema.org/draft/${draft}/vocab/`;
  const listed = new Set();
  Object.entries(vocabulary).forEach(([uri, isRequired]) => {
    const name = uri.startsWith(prefix) ? uri.slice(prefix.length) : undefined;
    if (name !== undefined && KNOWN_VOCABULARIES.includes(name)) {
      listed.add(name);
    } else if (isRequired === true) {
      throw new Error(`Unsupported JSON Schema: the meta-schema requires the vocabulary "${uri}"`);
    }
  });
  const ignored = new Set();
  Object.entries(VOCABULARY_KEYWORDS).forEach(([name, keywords]) => {
    const owner = draft === '2019-09' && name === 'unevaluated' ? 'applicator' : name;
    if (!listed.has(owner)) {
      keywords.forEach((keyword) => ignored.add(keyword));
    }
  });
  return ignored;
}

class RefIndex {
  // `draft` is the one of the root (by default the one its "$schema" names), and of the resources that name none and
  // are not inside one that does.
  constructor(root, schemas = undefined, draft = undefined) {
    this.root = root;
    // Other documents, by URI: resolved against the URI they are registered with, unless they change it with "$id".
    const documents = documentsOf(schemas);
    // Meta-schemas that "$schema" can name, which give a draft and vocabularies.
    this.documents = new Map(documents.map(({ uri, schema }) => [uri, schema]));
    this.rootDialect = draft === undefined ? this.dialectOf(root.$schema) || { draft: 'draft-07' } : { draft };
    this.draft = this.rootDialect.draft;
    // Resource URI to its dialect: { draft, ignored } with the keywords its vocabularies leave out.
    this.dialects = new Map();
    // Documents (URIs without fragment) and anchors ("uri#name") to their schema node.
    this.resources = new Map([[DEFAULT_BASE, root]]);
    this.anchors = new Map();
    // Resource URI to its dynamic anchors: name ('' for "$recursiveAnchor") to schema node.
    this.dynamicAnchors = new Map();
    // Schema node to the base URI its references are resolved against.
    this.bases = new Map();
    // Schema node to the dialect of its resource, which the conversion asks for every node.
    this.nodeDialects = new Map();
    // Schema node to the copy of it without the keywords its vocabularies leave out.
    this.views = new Map();
    this.visit(root, DEFAULT_BASE);
    documents.forEach(({ uri, schema }) => {
      this.addResource(uri, schema);
      this.visit(schema, uri);
    });
  }

  // The dialect "$schema" names: a draft, or a meta-schema of the "schemas" option with the draft its own "$schema"
  // names and the keywords its "$vocabulary" leaves out. Undefined when it names neither.
  dialectOf(schemaUri) {
    const draft = draftOfUri(schemaUri);
    if (draft !== undefined) {
      return { draft };
    }
    const meta = typeof schemaUri === 'string' ? this.documents.get(schemaUri.replace(/#$/, '')) : undefined;
    const metaDraft = isObject(meta) ? draftOfUri(meta.$schema) : undefined;
    if (metaDraft === undefined) {
      return undefined;
    }
    const hasVocabulary = !isLegacy(metaDraft) && isObject(meta.$vocabulary);
    return {
      draft: metaDraft,
      ignored: hasVocabulary ? ignoredKeywords(meta.$vocabulary, metaDraft) : undefined,
    };
  }

  // The node as its vocabularies see it: a copy without the keywords they leave out, or the node itself.
  viewOf(node) {
    const dialect = this.nodeDialects.get(node);
    const ignored = dialect && dialect.ignored;
    if (!ignored || !Object.keys(node).some((keyword) => ignored.has(keyword))) {
      return node;
    }
    if (!this.views.has(node)) {
      this.views.set(node, Object.fromEntries(Object.entries(node).filter(([keyword]) => !ignored.has(keyword))));
    }
    return this.views.get(node);
  }

  // The first document registered for a URI keeps it.
  addResource(uri, node) {
    if (!this.resources.has(uri)) {
      this.resources.set(uri, node);
    }
  }

  addDynamicAnchor(uri, name, node) {
    if (!this.dynamicAnchors.has(uri)) {
      this.dynamicAnchors.set(uri, new Map());
    }
    const anchors = this.dynamicAnchors.get(uri);
    if (!anchors.has(name)) {
      anchors.set(name, node);
    }
  }

  // Dynamic anchors of a resource, by name.
  dynamicAnchorsOf(uri) {
    return this.dynamicAnchors.get(uri) || new Map();
  }

  // URI of the resource a node belongs to, or undefined for a node that is not indexed.
  resourceOf(node) {
    return this.bases.get(node);
  }

  // Draft of the resource a node belongs to, or undefined for a node that is not indexed.
  draftOf(node) {
    const dialect = this.nodeDialects.get(node);
    return dialect && dialect.draft;
  }

  addAnchor(anchor, node) {
    if (!this.anchors.has(anchor)) {
      this.anchors.set(anchor, node);
    }
  }

  // Indexes a node and the schemas inside it. `parentDialect` is the dialect of the resource around it; a resource
  // that names another with "$schema" uses it (the root uses the one it was given).
  visit(node, parentBase, parentDialect = this.dialects.get(parentBase) || this.rootDialect) {
    if (!isObject(node) || this.bases.has(node)) {
      return;
    }
    const dialect = node === this.root ? this.rootDialect : this.dialectOf(node.$schema) || parentDialect;
    const { draft } = dialect;
    let base = parentBase;
    // Up to draft-07 every keyword next to "$ref" is ignored, "$id" included.
    const id = node[idKeyword(draft)];
    if (typeof id === 'string' && (node.$ref === undefined || !isLegacy(draft))) {
      const uri = resolveUri(id, parentBase);
      if (uri !== undefined) {
        const [document, fragment] = splitFragment(uri);
        const anchor = `${document}#${decode(fragment)}`;
        if (fragment === '') {
          base = document;
          this.addResource(document, node);
        } else {
          this.addAnchor(anchor, node);
        }
      }
    }
    if (!this.dialects.has(base)) {
      this.dialects.set(base, dialect);
    }
    // Anchors of the later drafts name the node within the resource of its base URI.
    if (!isLegacy(draft) && typeof node.$anchor === 'string') {
      this.addAnchor(`${base}#${node.$anchor}`, node);
    }
    if (draft === '2020-12' && typeof node.$dynamicAnchor === 'string') {
      this.addAnchor(`${base}#${node.$dynamicAnchor}`, node);
      this.addDynamicAnchor(base, node.$dynamicAnchor, node);
    }
    if (draft === '2019-09' && node.$recursiveAnchor === true && this.resources.get(base) === node) {
      this.addDynamicAnchor(base, '', node);
    }
    this.bases.set(node, base);
    this.nodeDialects.set(node, this.dialects.get(base));
    // Plain loops: every node of every schema goes through here when compiling.
    for (let i = 0; i < SCHEMA_KEYWORDS.length; i += 1) {
      const child = node[SCHEMA_KEYWORDS[i]];
      if (child !== undefined) {
        this.visit(child, base, dialect);
      }
    }
    for (let i = 0; i < SCHEMA_MAP_KEYWORDS.length; i += 1) {
      const map = node[SCHEMA_MAP_KEYWORDS[i]];
      if (isObject(map)) {
        const keys = Object.keys(map);
        for (let j = 0; j < keys.length; j += 1) {
          this.visit(map[keys[j]], base, dialect);
        }
      }
    }
    for (let i = 0; i < SCHEMA_LIST_KEYWORDS.length; i += 1) {
      const list = node[SCHEMA_LIST_KEYWORDS[i]];
      if (Array.isArray(list)) {
        for (let j = 0; j < list.length; j += 1) {
          this.visit(list[j], base, dialect);
        }
      }
    }
  }

  // The document `ref`, resolved against the base URI of `node`, points to when it is not registered: the one to load
  // for it to resolve. Undefined when it is registered, or relative to a document without "$id".
  missingDocument(node, ref) {
    const uri = resolveUri(ref, this.bases.get(node) ?? DEFAULT_BASE);
    if (uri === undefined) {
      return undefined;
    }
    const [document] = splitFragment(uri);
    const isKnown = this.resources.has(document) || new URL(document).protocol === new URL(DEFAULT_BASE).protocol;
    return isKnown ? undefined : document;
  }

  // Schema node that `ref` (by default the "$ref" of `node`), resolved against the base URI of `node`, points to, or
  // undefined when it is not in this document.
  resolve(node, ref = node.$ref) {
    const uri = resolveUri(ref, this.bases.get(node) ?? DEFAULT_BASE);
    if (uri === undefined) {
      return undefined;
    }
    const [document, rawFragment] = splitFragment(uri);
    const fragment = decode(rawFragment);
    if (fragment === undefined) {
      return undefined;
    }
    let target;
    if (fragment === '' || fragment.startsWith('/')) {
      const resource = this.resources.get(document);
      target = resource === undefined ? undefined : followPointer(resource, fragment);
      if (target !== undefined) {
        // A pointer can reach a node that was not indexed as a schema; its references resolve against the document.
        this.visit(target, document);
      }
    } else {
      target = this.anchors.get(`${document}#${fragment}`);
    }
    return target;
  }
}

module.exports = {
  RefIndex,
  draftOfUri,
  isLegacy,
  documentsOf,
};
