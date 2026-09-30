// Schemas inferred from sample values: inferJsonSchema() gives a JSON Schema and inferSchemaCode() the source of the
// same schema in the DSL. The samples are merged position by position: the types seen at each one (an integer and a
// number give "number", null makes it nullable), the keys of objects (required when every object at that position has
// them), and the elements of arrays, all merged into one schema. Strings get a format when every one matches it.
const { FORMATS, matchesFormat } = require('./formats');

// The formats detected, in order of preference: the first one every string matches is chosen. Host names, URI
// references and the like match plain words, so they are left out; a URI needs "scheme://".
const FORMAT_CANDIDATES = ['date-time', 'date', 'time', 'email', 'uuid', 'ipv4', 'ipv6', 'uri'];
const matchesCandidate = (name, text) =>
  name === 'uri'
    ? /^[a-z][a-z0-9+.-]*:\/\//i.test(text) && matchesFormat(FORMATS.uri, text)
    : matchesFormat(FORMATS[name], text);

const DRAFT_URIS = {
  'draft-04': 'http://json-schema.org/draft-04/schema#',
  'draft-06': 'http://json-schema.org/draft-06/schema#',
  'draft-07': 'http://json-schema.org/draft-07/schema#',
  '2019-09': 'https://json-schema.org/draft/2019-09/schema',
  '2020-12': 'https://json-schema.org/draft/2020-12/schema',
};

const isIdentifier = (key) => /^[A-Za-z_$][\w$]*$/.test(key);
const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

// What the samples show at one position.
const newNode = () => ({
  null: false,
  boolean: false,
  integer: false,
  number: false,
  string: null,
  array: null,
  object: null,
});

function add(node, value, path) {
  if (value === null) {
    node.null = true;
  } else if (typeof value === 'boolean') {
    node.boolean = true;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot infer a schema: ${value} at ${path || 'the value'} is not a JSON value`);
    }
    node[Number.isInteger(value) ? 'integer' : 'number'] = true;
  } else if (typeof value === 'string') {
    node.string = node.string || { formats: FORMAT_CANDIDATES };
    node.string.formats = node.string.formats.filter((name) => matchesCandidate(name, value));
  } else if (Array.isArray(value)) {
    node.array = node.array || { items: null };
    value.forEach((item, index) => {
      node.array.items = node.array.items || newNode();
      add(node.array.items, item, `${path}[${index}]`);
    });
  } else if (isPlainObject(value)) {
    node.object = node.object || { count: 0, keys: new Map() };
    node.object.count += 1;
    Object.keys(value).forEach((key) => {
      // A key whose value is undefined (in JavaScript samples) is taken as absent, as JSON leaves it out.
      if (value[key] === undefined) {
        return;
      }
      if (!node.object.keys.has(key)) {
        node.object.keys.set(key, { node: newNode(), count: 0 });
      }
      const entry = node.object.keys.get(key);
      entry.count += 1;
      add(entry.node, value[key], path ? `${path}.${key}` : key);
    });
  } else {
    const what = value instanceof Date ? 'a Date (use its ISO string)' : `a ${typeof value}`;
    throw new Error(`Cannot infer a schema: ${path || 'the value'} is ${what}, not a JSON value`);
  }
}

function optionsOf(options) {
  const { closed = false, formats = true, draft = '2020-12' } = options;
  if (!Object.prototype.hasOwnProperty.call(DRAFT_URIS, draft)) {
    throw new Error(`Unsupported option "draft": "${draft}" is not one of ${Object.keys(DRAFT_URIS).join(', ')}`);
  }
  return { closed: closed === true, formats: formats !== false, draft };
}

function modelOf(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('Cannot infer a schema: expected a non-empty array of sample values');
  }
  const root = newNode();
  samples.forEach((sample) => add(root, sample, ''));
  return root;
}

// The JSON types a node holds, without null, in the order they are written.
function typesOf(node) {
  const types = [];
  if (node.object) types.push('object');
  if (node.array) types.push('array');
  if (node.string) types.push('string');
  if (node.number) types.push('number');
  else if (node.integer) types.push('integer');
  if (node.boolean) types.push('boolean');
  return types;
}

const formatOf = (node, options) => (options.formats && node.string.formats[0]) || undefined;

function toJsonSchema(node, options) {
  const types = typesOf(node);
  // Only null (or nothing, for the elements of empty arrays): the type is unknown, so anything is accepted.
  if (types.length === 0) {
    return {};
  }
  const allTypes = node.null ? [...types, 'null'] : types;
  const schema = { type: allTypes.length === 1 ? allTypes[0] : allTypes };
  if (node.string && formatOf(node, options)) {
    schema.format = formatOf(node, options);
  }
  if (node.array && node.array.items) {
    schema.items = toJsonSchema(node.array.items, options);
  }
  if (node.object) {
    const keys = [...node.object.keys];
    schema.properties = Object.fromEntries(keys.map(([key, entry]) => [key, toJsonSchema(entry.node, options)]));
    const required = keys.filter(([, entry]) => entry.count === node.object.count).map(([key]) => key);
    if (required.length > 0) {
      schema.required = required;
    }
    if (options.closed) {
      schema.additionalProperties = false;
    }
  }
  return schema;
}

// A JSON Schema that accepts every sample. Options: closed (additionalProperties: false on objects), formats (detect
// formats, default true) and draft (the "$schema" written, default '2020-12').
function inferJsonSchema(samples, options = {}) {
  const settings = optionsOf(options);
  return { $schema: DRAFT_URIS[settings.draft], ...toJsonSchema(modelOf(samples), settings) };
}

const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

// The DSL source of a node, with its options (isMandatory, isNullable), noting the names it uses.
function toCode(node, options, extra, indent, used) {
  const pad = ' '.repeat(indent);
  const types = typesOf(node);
  const settings = [...extra];
  const use = (name) => {
    used.add(name);
    return name;
  };
  const call = (name, own = []) => {
    const all = [...own, ...settings];
    return `${use(name)}(${all.length ? `{ ${all.join(', ')} }` : ''})`;
  };
  if (types.length === 0) {
    return call('Any', ['isNullable: true']);
  }
  if (node.null) {
    settings.push('isNullable: true');
  }
  const codeOf = (type, own) => {
    switch (type) {
      case 'string': {
        const format = formatOf(node, options);
        return call('String', [...own, ...(format ? [`format: ${quote(format)}`] : [])]);
      }
      case 'integer':
        return call('Integer', own);
      case 'number':
        return call('Float', own);
      case 'boolean':
        return call('Boolean', own);
      case 'array': {
        const { items } = node.array;
        const typeOption = items ? [`type: ${toCode(items, options, [], indent, used)}`] : [];
        return call('ArrayOf', [...typeOption, ...own]);
      }
      default: {
        const name = use(options.closed ? 'ClosedSchema' : 'Schema');
        const entries = [...node.object.keys].map(([key, entry]) => {
          const optional = entry.count === node.object.count ? [] : ['isMandatory: false'];
          const value = toCode(entry.node, options, optional, indent + 2, used);
          return `${pad}  ${isIdentifier(key) ? key : quote(key)}: ${value},`;
        });
        const body = entries.length ? `{\n${entries.join('\n')}\n${pad}}` : '{}';
        const all = [...own, ...settings];
        return `new ${name}(${body}${all.length ? `, { ${all.join(', ')} }` : ''})`;
      }
    }
  };
  if (types.length === 1) {
    return codeOf(types[0], []);
  }
  // Several types: each one mandatory and not null, the combination takes the options.
  const inner = types.map((type) => toCode({ ...newNode(), [type]: node[type] }, options, [], indent + 2, used));
  return call('AnyOf', [`types: [${inner.join(', ')}]`]);
}

// The same schema as inferJsonSchema(), as the source of a JavaScript module using the DSL. Options: closed and
// formats, as there; name (of the variable, default 'schema'); module: 'commonjs' (default), 'esm' or 'none' (the
// import line).
function inferSchemaCode(samples, options = {}) {
  const settings = optionsOf(options);
  const { name = 'schema', module = 'commonjs' } = options;
  if (!isIdentifier(name)) {
    throw new Error(`Unsupported option "name": "${name}" is not a JavaScript identifier`);
  }
  if (!['commonjs', 'esm', 'none'].includes(module)) {
    throw new Error(`Unsupported option "module": "${module}" is not one of commonjs, esm, none`);
  }
  const used = new Set();
  const code = toCode(modelOf(samples), settings, [], 0, used);
  const names = [...used].sort().join(', ');
  const header = {
    commonjs: `const { ${names} } = require('schiva');\n\n`,
    esm: `import { ${names} } from 'schiva';\n\n`,
    none: '',
  }[module];
  return `${header}const ${name} = ${code};\n`;
}

module.exports = { inferJsonSchema, inferSchemaCode };
