// The keywords of ajv-keywords (https://github.com/ajv-validator/ajv-keywords), as definitions for the option "keywords"
// of compileJsonSchema(): ajvKeywords() gives all of them, ajvKeywords(['range', 'typeof']) the ones named. The ones
// that are other keywords written shorter are macros, and compile to the same code as those keywords.
const { deepEqual } = require('./deep-equal');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const list = (value) => (Array.isArray(value) ? value : [value]);

// Throws when the value of `keyword` in a schema is not what it takes.
function expect(isValid, keyword, what) {
  if (!isValid) {
    throw new Error(`Unsupported JSON Schema: "${keyword}" must be ${what}`);
  }
}

const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

const TYPEOF_NAMES = ['undefined', 'string', 'number', 'object', 'function', 'boolean', 'symbol', 'bigint'];

// Constructors "instanceof" can name, as in ajv-keywords.
const CONSTRUCTORS = {
  Object,
  Array,
  Function,
  Number,
  String,
  Boolean,
  Date,
  RegExp,
  Map,
  Set,
  Promise,
  ...(typeof Buffer === 'undefined' ? {} : { Buffer }),
};

// The regular expression of "regexp": "/source/flags" or { pattern, flags }, as ajv-keywords reads it.
function regExpOf(value) {
  const what = 'a string "/pattern/flags" or { pattern, flags }';
  if (typeof value === 'string') {
    const match = /^\/(.*)\/([a-z]*)$/s.exec(value);
    expect(match !== null, 'regexp', what);
    return new RegExp(match[1], match[2]);
  }
  expect(isObject(value) && typeof value.pattern === 'string', 'regexp', what);
  return new RegExp(value.pattern, value.flags);
}

const unescapeToken = (token) => token.replace(/~1/g, '/').replace(/~0/g, '~');

// The schema "deepProperties" gives for one JSON pointer: nested "properties" down to `schema`, with the tuple of an
// array for a numeric token, as in ajv-keywords.
function deepPropertySchema(pointer, schema, draft) {
  const tokens = pointer.split('/').slice(1).map(unescapeToken);
  const root = {};
  let current = root;
  tokens.forEach((token, i) => {
    const next = i === tokens.length - 1 ? schema : {};
    current.properties = { [token]: next };
    if (/^[0-9]+$/.test(token)) {
      current.type = ['object', 'array'];
      current[draft === '2020-12' ? 'prefixItems' : 'items'] = [
        ...Array.from({ length: Number(token) }, () => ({})),
        next,
      ];
    } else {
      current.type = 'object';
    }
    current = next;
  });
  return root;
}

// Whether the value at a JSON pointer of `data` is defined, as ajv-keywords reads it for "deepRequired": the path is
// followed while the values on it are truthy (like data.a && data.a.b).
function isDefinedAt(data, tokens) {
  let current = data;
  for (let i = 0; i < tokens.length && current; i += 1) {
    current = current[tokens[i]];
  }
  return current !== undefined;
}

const DEFINITIONS = {
  typeof: {
    compile(value) {
      const names = list(value);
      expect(
        names.every((name) => TYPEOF_NAMES.includes(name)),
        'typeof',
        `one of ${TYPEOF_NAMES.join(', ')}`
      );
      return (data) => names.includes(typeof data);
    },
    message: (value) => `must be of typeof ${list(value).join(' or ')}`,
  },
  instanceof: {
    compile(value) {
      const names = list(value);
      const known = Object.keys(CONSTRUCTORS);
      expect(
        names.every((name) => known.includes(name)),
        'instanceof',
        `one of ${known.join(', ')}`
      );
      const constructors = names.map((name) => CONSTRUCTORS[name]);
      return (data) => constructors.some((constructor) => data instanceof constructor);
    },
    message: (value) => `must be an instance of ${list(value).join(' or ')}`,
  },
  range: {
    type: 'number',
    macro(value) {
      expect(Array.isArray(value) && value.length === 2 && value[0] <= value[1], 'range', '[minimum, maximum]');
      return { minimum: value[0], maximum: value[1] };
    },
  },
  exclusiveRange: {
    type: 'number',
    macro(value, parentSchema, { draft }) {
      expect(Array.isArray(value) && value.length === 2 && value[0] < value[1], 'exclusiveRange', '[minimum, maximum]');
      return draft === 'draft-04'
        ? { minimum: value[0], exclusiveMinimum: true, maximum: value[1], exclusiveMaximum: true }
        : { exclusiveMinimum: value[0], exclusiveMaximum: value[1] };
    },
  },
  regexp: {
    type: 'string',
    compile(value) {
      const regExp = regExpOf(value);
      // A regular expression is tested as it is, unless its flags make test() depend on the previous call.
      if (!regExp.global && !regExp.sticky) {
        return regExp;
      }
      return (data) => {
        regExp.lastIndex = 0;
        return regExp.test(data);
      };
    },
    message: (value) => `must match ${String(regExpOf(value))}`,
  },
  uniqueItemProperties: {
    type: 'array',
    compile(value) {
      expect(isStringList(value), 'uniqueItemProperties', 'a list of property names');
      // As in ajv-keywords, the elements that are objects (or arrays) count, and a missing property is a value too.
      return (data) =>
        value.every((key) => {
          const primitives = new Set();
          const objects = [];
          return data.every((item) => {
            if (item === null || typeof item !== 'object') {
              return true;
            }
            const property = item[key];
            if (property !== null && typeof property === 'object') {
              if (objects.some((other) => deepEqual(other, property))) {
                return false;
              }
              objects.push(property);
              return true;
            }
            if (primitives.has(property)) {
              return false;
            }
            primitives.add(property);
            return true;
          });
        });
    },
    message: (value) => `must have elements with unique ${value.join(', ')}`,
  },
  allRequired: {
    type: 'object',
    macro(value, parentSchema) {
      expect(typeof value === 'boolean', 'allRequired', 'true or false');
      if (!value) {
        return true;
      }
      expect(isObject(parentSchema.properties), 'allRequired', 'next to "properties"');
      return { required: Object.keys(parentSchema.properties) };
    },
  },
  anyRequired: {
    type: 'object',
    macro(value) {
      expect(isStringList(value), 'anyRequired', 'a list of property names');
      return { anyOf: value.map((key) => ({ required: [key] })) };
    },
  },
  oneRequired: {
    type: 'object',
    macro(value) {
      expect(isStringList(value), 'oneRequired', 'a list of property names');
      return { oneOf: value.map((key) => ({ required: [key] })) };
    },
  },
  patternRequired: {
    type: 'object',
    compile(value) {
      expect(isStringList(value), 'patternRequired', 'a list of patterns');
      const regExps = value.map((source) => new RegExp(source, 'u'));
      return (data) => {
        const keys = Object.keys(data);
        return regExps.every((regExp) => keys.some((key) => regExp.test(key)));
      };
    },
    message: (value) => `must have keys matching ${value.join(', ')}`,
  },
  prohibited: {
    type: 'object',
    macro(value) {
      expect(isStringList(value), 'prohibited', 'a list of property names');
      return { properties: Object.fromEntries(value.map((key) => [key, false])) };
    },
  },
  deepProperties: {
    type: 'object',
    macro(value, parentSchema, { draft }) {
      expect(isObject(value), 'deepProperties', 'an object of schemas by JSON pointer');
      return { allOf: Object.entries(value).map(([pointer, schema]) => deepPropertySchema(pointer, schema, draft)) };
    },
  },
  deepRequired: {
    type: 'object',
    compile(value) {
      expect(
        isStringList(value) && value.every((pointer) => pointer.startsWith('/')),
        'deepRequired',
        'a list of JSON pointers'
      );
      const paths = value.map((pointer) => pointer.split('/').slice(1).map(unescapeToken));
      return (data) => paths.every((tokens) => isDefinedAt(data, tokens));
    },
    message: (value, data) => {
      const missing = value.filter((pointer) => !isDefinedAt(data, pointer.split('/').slice(1).map(unescapeToken)));
      return `must have ${missing.join(', ')}`;
    },
  },
};

// Keywords of ajv-keywords that schiva leaves out, with the reason.
const LEFT_OUT = {
  transform:
    'it changes the data (schiva only assigns defaults and removes properties, see useDefaults and removeAdditional)',
  dynamicDefaults: 'it computes defaults when validating; use useDefaults with fixed defaults',
  select: 'it needs $data references',
  selectCases: 'it needs $data references',
  selectDefault: 'it needs $data references',
};

// Definitions of the keywords of ajv-keywords named in `names` (all of them by default).
function ajvKeywords(names = Object.keys(DEFINITIONS)) {
  return list(names).map((name) => {
    if (hasOwn(LEFT_OUT, name)) {
      throw new Error(`ajvKeywords: "${name}" is not supported: ${LEFT_OUT[name]}`);
    }
    if (!hasOwn(DEFINITIONS, name)) {
      throw new Error(
        `ajvKeywords: unknown keyword "${name}"; the keywords are ${Object.keys(DEFINITIONS).join(', ')}`
      );
    }
    return { keyword: name, ...DEFINITIONS[name] };
  });
}

module.exports = {
  ajvKeywords,
};
