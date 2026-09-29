// Resolution of JSON Schema (draft-07) references: JSON pointers ("#/definitions/a"), "$id" base URI changes and "$id"
// anchors ("#foo"), within the schema and within other documents registered by URI. Nothing is loaded from the
// network: a reference to a document that is not registered does not resolve.

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
];
const SCHEMA_MAP_KEYWORDS = ['definitions', 'dependencies', 'patternProperties', 'properties'];
const SCHEMA_LIST_KEYWORDS = ['allOf', 'anyOf', 'items', 'oneOf'];

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

// Documents to register, from { uri: schema } or [schema with "$id"]. URIs must be absolute, without a fragment other
// than an empty one ("http://json-schema.org/draft-07/schema#").
function documentsOf(schemas) {
  if (schemas === undefined) {
    return [];
  }
  let entries;
  if (Array.isArray(schemas)) {
    entries = schemas.map((schema) => [schema && schema.$id, schema]);
  } else if (isObject(schemas)) {
    entries = Object.entries(schemas);
  } else {
    throw new Error('Unsupported JSON Schema option "schemas": expected an object of schemas by URI or an array');
  }
  return entries.map(([uri, schema]) => {
    const absolute = typeof uri === 'string' ? resolveUri(uri, undefined) : undefined;
    const [document, fragment] = absolute === undefined ? [] : splitFragment(absolute);
    if (absolute === undefined || fragment !== '') {
      throw new Error(`Unsupported JSON Schema option "schemas": "${uri}" is not an absolute URI without fragment`);
    }
    return { uri: document, schema };
  });
}

class RefIndex {
  constructor(root, schemas = undefined) {
    // Documents (URIs without fragment) and anchors ("uri#name") to their schema node.
    this.resources = new Map([[DEFAULT_BASE, root]]);
    this.anchors = new Map();
    // Schema node to the base URI its references are resolved against.
    this.bases = new Map();
    this.visit(root, DEFAULT_BASE);
    // Other documents are resolved against the URI they are registered with, unless they change it with "$id".
    documentsOf(schemas).forEach(({ uri, schema }) => {
      this.addResource(uri, schema);
      this.visit(schema, uri);
    });
  }

  // The first document registered for a URI keeps it.
  addResource(uri, node) {
    if (!this.resources.has(uri)) {
      this.resources.set(uri, node);
    }
  }

  visit(node, parentBase) {
    if (!isObject(node) || this.bases.has(node)) {
      return;
    }
    let base = parentBase;
    // In draft-07 every keyword next to "$ref" is ignored, "$id" included.
    if (typeof node.$id === 'string' && node.$ref === undefined) {
      const uri = resolveUri(node.$id, parentBase);
      if (uri !== undefined) {
        const [document, fragment] = splitFragment(uri);
        const anchor = `${document}#${decode(fragment)}`;
        if (fragment === '') {
          base = document;
          this.addResource(document, node);
        } else if (!this.anchors.has(anchor)) {
          this.anchors.set(anchor, node);
        }
      }
    }
    this.bases.set(node, base);
    SCHEMA_KEYWORDS.forEach((keyword) => this.visit(node[keyword], base));
    SCHEMA_MAP_KEYWORDS.filter((keyword) => isObject(node[keyword])).forEach((keyword) =>
      Object.values(node[keyword]).forEach((child) => this.visit(child, base))
    );
    SCHEMA_LIST_KEYWORDS.filter((keyword) => Array.isArray(node[keyword])).forEach((keyword) =>
      node[keyword].forEach((child) => this.visit(child, base))
    );
  }

  // Schema node that the "$ref" of `node` points to, or undefined when it is not in this document.
  resolve(node) {
    const uri = resolveUri(node.$ref, this.bases.get(node) ?? DEFAULT_BASE);
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
};
