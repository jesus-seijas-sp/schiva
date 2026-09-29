// Adapters: each entry exposes compile(schema, remotes) -> (data) => boolean.
// Libraries with several modes are listed once per mode, so each row can be compared with one doing the same work:
// (boolean) only tells whether the data is valid, (first error) builds the first error, (all errors) builds all.
// `remotes` ({ uri: schema }, optional) are other documents that "$ref" can point to; each library gets them through
// its own registration API.
const Ajv = require('ajv');
const Ajv2019 = require('ajv/dist/2019').default;
const Ajv2020 = require('ajv/dist/2020').default;
const { validator: schemasafe } = require('@exodus/schemasafe');
const imjv = require('is-my-json-valid');
const djv = require('djv');
const jsen = require('jsen');
const ZSchema = require('z-schema').default;
const { Validator: JsonschemaValidator } = require('jsonschema');
const { Validator: CfValidator } = require('@cfworker/json-schema');
const tv4 = require('tv4');
const { compileSchema: jslCompile } = require('json-schema-library');
const { compileJsonSchema } = require('../src');

const clone = (x) => JSON.parse(JSON.stringify(x));

const DRAFT_07 = 'http://json-schema.org/draft-07/schema';

const schemasafeOptions = { mode: 'spec', $schemaDefault: `${DRAFT_07}#` };

// Copies of the remotes, so no library sees the changes another one makes.
const each = (remotes = {}) => Object.entries(remotes).map(([uri, schema]) => [uri, clone(schema)]);
const asObject = (remotes) => Object.fromEntries(each(remotes));

function schiva(options) {
  return (schema, remotes) => compileJsonSchema(clone(schema), { ...options, schemas: asObject(remotes) });
}

function ajv(options) {
  return (schema, remotes) => {
    const instance = new Ajv({ strict: false, ...options });
    // ajv has the draft-07 meta-schema already.
    each(remotes)
      .filter(([uri]) => uri !== DRAFT_07)
      .forEach(([uri, remote]) => instance.addSchema(remote, uri));
    return instance.compile(clone(schema));
  };
}

const validators = [
  // First entry: the suite benchmark times the groups this one passes.
  {
    name: 'schiva (all errors)',
    compile: (schema, remotes) => {
      const fn = schiva({})(schema, remotes);
      return (data) => fn(data).length === 0;
    },
  },
  {
    name: 'schiva (first error)',
    compile: (schema, remotes) => {
      const fn = schiva({ allErrors: false })(schema, remotes);
      return (data) => fn(data).length === 0;
    },
  },
  {
    name: 'schiva (boolean)',
    compile: schiva({ errors: false }),
  },
  {
    name: 'ajv (first error)',
    compile: ajv({}),
  },
  {
    name: 'ajv (all errors)',
    compile: ajv({ allErrors: true }),
  },
  {
    name: '@exodus/schemasafe (boolean)',
    compile: (schema, remotes) => schemasafe(clone(schema), { ...schemasafeOptions, schemas: asObject(remotes) }),
  },
  {
    name: '@exodus/schemasafe (first error)',
    compile: (schema, remotes) =>
      schemasafe(clone(schema), { ...schemasafeOptions, schemas: asObject(remotes), includeErrors: true }),
  },
  {
    name: '@exodus/schemasafe (all errors)',
    compile: (schema, remotes) =>
      schemasafe(clone(schema), {
        ...schemasafeOptions,
        schemas: asObject(remotes),
        includeErrors: true,
        allErrors: true,
      }),
  },
  {
    name: 'is-my-json-valid',
    compile: (schema, remotes) => {
      const v = imjv(clone(schema), { schemas: asObject(remotes) });
      return (data) => v(data);
    },
  },
  {
    name: 'djv',
    compile: (schema, remotes) => {
      const env = djv();
      each(remotes).forEach(([uri, remote]) => env.addSchema(uri, remote));
      env.addSchema('s', clone(schema));
      return (data) => env.validate('s#', data) === undefined;
    },
  },
  {
    name: 'jsen',
    compile: (schema, remotes) => jsen(clone(schema), { schemas: asObject(remotes) }),
  },
  {
    name: 'z-schema',
    compile: (schema, remotes) => {
      each(remotes).forEach(([uri, remote]) => ZSchema.setRemoteReference(uri, remote));
      const z = ZSchema.create();
      const s = clone(schema);
      z.validateSchema(s);
      return (data) => {
        try {
          return z.validate(data, s);
        } catch (e) {
          return false;
        }
      };
    },
  },
  {
    name: '@cfworker/json-schema',
    compile: (schema, remotes) => {
      const v = new CfValidator(clone(schema), '7', false);
      each(remotes).forEach(([uri, remote]) => v.addSchema(remote, uri));
      return (data) => v.validate(data).valid;
    },
  },
  {
    name: 'json-schema-library',
    compile: (schema, remotes) => {
      const node = jslCompile(clone(schema));
      each(remotes).forEach(([uri, remote]) => node.addRemoteSchema(uri, remote));
      return (data) => node.validate(data).valid;
    },
  },
  {
    name: 'jsonschema',
    compile: (schema, remotes) => {
      const v = new JsonschemaValidator();
      each(remotes).forEach(([uri, remote]) => v.addSchema(remote, uri));
      const s = clone(schema);
      return (data) => v.validate(data, s).valid;
    },
  },
  {
    name: 'tv4',
    compile: (schema, remotes) => {
      const api = tv4.freshApi();
      each(remotes).forEach(([uri, remote]) => api.addSchema(uri, remote));
      const s = clone(schema);
      return (data) => api.validate(data, s);
    },
  },
];

// Validators of drafts 2019-09 and 2020-12: schiva, and the libraries above that implement them, each set to the draft
// (the others implement draft-07 at most). ajv has a class for each draft, with its meta-schemas already added.
const LATER_DRAFTS = {
  'draft2019-09': { Ajv: Ajv2019, uri: 'https://json-schema.org/draft/2019-09/schema', cfworker: '2019-09' },
  'draft2020-12': { Ajv: Ajv2020, uri: 'https://json-schema.org/draft/2020-12/schema', cfworker: '2020-12' },
};

function ajvOf(AjvClass, options) {
  return (schema, remotes) => {
    const instance = new AjvClass({ strict: false, ...options });
    each(remotes)
      .filter(([uri]) => !uri.startsWith('https://json-schema.org/'))
      .forEach(([uri, remote]) => instance.addSchema(remote, uri));
    return instance.compile(clone(schema));
  };
}

function forDraft(draft = 'draft7') {
  if (draft === 'draft7') {
    return validators;
  }
  const { Ajv: AjvClass, uri, cfworker } = LATER_DRAFTS[draft];
  const safeOptions = (remotes, extra = {}) => ({
    mode: 'spec',
    $schemaDefault: uri,
    schemas: asObject(remotes),
    ...extra,
  });
  return [
    ...validators.filter((validator) => validator.name.startsWith('schiva')),
    { name: 'ajv (first error)', compile: ajvOf(AjvClass, {}) },
    { name: 'ajv (all errors)', compile: ajvOf(AjvClass, { allErrors: true }) },
    {
      name: '@exodus/schemasafe (boolean)',
      compile: (schema, remotes) => schemasafe(clone(schema), safeOptions(remotes)),
    },
    {
      name: '@exodus/schemasafe (first error)',
      compile: (schema, remotes) => schemasafe(clone(schema), safeOptions(remotes, { includeErrors: true })),
    },
    {
      name: '@exodus/schemasafe (all errors)',
      compile: (schema, remotes) =>
        schemasafe(clone(schema), safeOptions(remotes, { includeErrors: true, allErrors: true })),
    },
    {
      name: '@cfworker/json-schema',
      compile: (schema, remotes) => {
        const v = new CfValidator(clone(schema), cfworker, false);
        each(remotes).forEach(([remoteUri, remote]) => v.addSchema(remote, remoteUri));
        return (data) => v.validate(data).valid;
      },
    },
    {
      name: 'json-schema-library',
      compile: (schema, remotes) => {
        const node = jslCompile(clone(schema));
        each(remotes).forEach(([remoteUri, remote]) => node.addRemoteSchema(remoteUri, remote));
        return (data) => node.validate(data).valid;
      },
    },
  ];
}

// The draft-07 validators, as before; forDraft() gives the ones of each draft.
module.exports = validators;
module.exports.forDraft = forDraft;
