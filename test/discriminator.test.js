const { compileJsonSchema, standaloneJsonSchema, toErrors, Float, OneOfType, Schema, Values } = require('../src');

const pets = {
  type: 'object',
  required: ['kind'],
  discriminator: { propertyName: 'kind' },
  oneOf: [
    { properties: { kind: { const: 'cat' }, lives: { type: 'integer' } }, required: ['lives'] },
    { properties: { kind: { enum: ['dog', 'puppy'] }, bark: { type: 'boolean' } } },
  ],
};

// Every mode gives the same verdict, and the first error is the first of all errors.
function check(schema, value, options = {}) {
  const errors = compileJsonSchema(schema, options)(value);
  expect(compileJsonSchema(schema, { ...options, allErrors: false })(value)).toEqual(errors.slice(0, 1));
  expect(compileJsonSchema(schema, { ...options, errors: false })(value)).toBe(errors.length === 0);
  return errors;
}

describe('discriminator', () => {
  it('Should check an object only against the schema its tag picks', () => {
    expect(check(pets, { kind: 'cat', lives: 9 })).toEqual([]);
    expect(check(pets, { kind: 'puppy' })).toEqual([]);
    expect(check(pets, { kind: 'cat' })).toEqual(['lives is mandatory']);
    expect(check(pets, { kind: 'dog', bark: 1 })).toEqual(['bark must be a boolean']);
  });

  it('Should report a missing, non-string or unknown tag at its path', () => {
    expect(check(pets, {})).toEqual(['kind is mandatory']);
    expect(check(pets, { kind: 3 })).toEqual(['kind must be a string']);
    expect(check(pets, { kind: 'cow' })).toEqual(['kind must be one of: cat, dog, puppy']);
    expect(check({ type: 'array', items: pets }, [{ kind: 'cow' }])).toEqual([
      'Value[0].kind must be one of: cat, dog, puppy',
    ]);
  });

  it('Should give error objects with the keyword "discriminator"', () => {
    const validate = compileJsonSchema(pets, { errors: 'objects' });
    expect(validate({ kind: 'cow' })).toEqual([
      {
        path: ['kind'],
        pointer: '/kind',
        keyword: 'discriminator',
        params: { error: 'mapping', tag: 'kind', tagValue: 'cow' },
        message: 'kind must be one of: cat, dog, puppy',
      },
    ]);
    expect(validate({ kind: 3 })[0].params).toEqual({ error: 'tag', tag: 'kind', tagValue: 3 });
  });

  it('Should check other values as "oneOf" does', () => {
    const schema = { ...pets, type: undefined };
    delete schema.type;
    expect(check(schema, 'x')).toEqual(['Value must match exactly one schema, but matches more than one']);
  });

  it('Should read the tag of a schema through its reference, and accept it required by every schema', () => {
    const schema = {
      definitions: { cat: { properties: { kind: { const: 'cat' } }, required: ['kind', 'lives'] } },
      discriminator: { propertyName: 'kind' },
      oneOf: [{ $ref: '#/definitions/cat' }, { properties: { kind: { const: 'dog' } }, required: ['kind'] }],
    };
    expect(check(schema, { kind: 'cat' })).toEqual(['lives is mandatory']);
    expect(check(schema, { kind: 'dog' })).toEqual([]);
  });

  it('Should give the same result in standalone code', () => {
    const module = { exports: {} };
    // eslint-disable-next-line no-new-func -- loads the generated module
    new Function('module', 'exports', standaloneJsonSchema(pets))(module, module.exports);
    expect(module.exports({ kind: 'cow' })).toEqual(['kind must be one of: cat, dog, puppy']);
    expect(module.exports({ kind: 'cat', lives: 1 })).toEqual([]);
  });

  it('Should count what the picked schema evaluates for "unevaluatedProperties"', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      ...pets,
      unevaluatedProperties: false,
    };
    expect(check(schema, { kind: 'cat', lives: 1 })).toEqual([]);
    expect(check(schema, { kind: 'cat', lives: 1, bark: true })).toEqual(['Unexpected key: bark']);
  });

  it('Should read the tag as an own property', () => {
    const schema = {
      type: 'object',
      required: ['constructor'],
      discriminator: { propertyName: 'constructor' },
      oneOf: [{ properties: { constructor: { const: 'a' } } }],
    };
    expect(check(schema, {})).toEqual(['constructor is mandatory']);
    expect(check(schema, { constructor: 'a' })).toEqual([]);
    expect(check(pets, Object.create({ kind: 'cat' }))).toEqual(['kind is mandatory']);
  });

  it('Should throw on invalid discriminators', () => {
    const at = 'Unsupported JSON Schema at #: "discriminator"';
    expect(() => compileJsonSchema({ discriminator: { propertyName: 'kind' } })).toThrow(`${at} requires "oneOf"`);
    expect(() => compileJsonSchema({ ...pets, discriminator: {} })).toThrow(`${at} requires "propertyName"`);
    expect(() => compileJsonSchema({ ...pets, oneOf: [pets.oneOf[0], pets.oneOf[0]] })).toThrow(
      `${at}: the values of "kind" must be unique strings`
    );
    expect(() => compileJsonSchema({ ...pets, oneOf: [{ properties: { kind: { const: 1 } } }] })).toThrow(
      `${at}: the values of "kind" must be unique strings`
    );
    expect(() => compileJsonSchema({ ...pets, required: [] })).toThrow(`${at}: "kind" must be required`);
    expect(() => compileJsonSchema({ ...pets, oneOf: [{ properties: { kind: { type: 'string' } } }] })).toThrow(
      `${at}: every "oneOf" schema needs a value of "kind"`
    );
  });

  describe('mapping', () => {
    // An OpenAPI document: the schemas do not give the tag a value.
    const api = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: {
        Cat: {
          type: 'object',
          properties: { petType: { type: 'string' }, lives: { type: 'integer' } },
          required: ['petType', 'lives'],
        },
        Dog: {
          type: 'object',
          properties: { petType: { type: 'string' }, bark: { type: 'boolean' } },
          required: ['petType'],
        },
      },
      oneOf: [{ $ref: '#/$defs/Cat' }, { $ref: '#/$defs/Dog' }],
    };
    const mapped = { ...api, discriminator: { propertyName: 'petType', mapping: { cat: '#/$defs/Cat', dog: 'Dog' } } };

    it('Should pick the schema a mapping names, by reference or by name', () => {
      expect(check(mapped, { petType: 'cat', lives: 1 })).toEqual([]);
      expect(check(mapped, { petType: 'dog' })).toEqual([]);
      expect(check(mapped, { petType: 'cat' })).toEqual(['lives is mandatory']);
      expect(check(mapped, { petType: 'Cat', lives: 1 })).toEqual(['petType must be one of: cat, dog']);
    });

    it('Should check only the schema it picks, whatever the others accept, as OpenAPI does', () => {
      // Both schemas accept this value, so oneOf alone rejects it.
      const both = { petType: 'dog', lives: 1, bark: true };
      expect(check(api, both)).toEqual(['Value must match exactly one schema, but matches more than one']);
      expect(check(mapped, both)).toEqual([]);
    });

    it('Should use the names of the referenced schemas without a mapping', () => {
      const implicit = { ...api, discriminator: { propertyName: 'petType' } };
      expect(check(implicit, { petType: 'Dog' })).toEqual([]);
      expect(check(implicit, { petType: 'dog' })).toEqual(['petType must be one of: Cat, Dog']);
      const partly = { ...api, discriminator: { propertyName: 'petType', mapping: { kitty: '#/$defs/Cat' } } };
      expect(check(partly, { petType: 'kitty', lives: 1 })).toEqual([]);
      expect(check(partly, { petType: 'Dog' })).toEqual([]);
      expect(check(partly, { petType: 'Cat', lives: 1 })).toEqual(['petType must be one of: kitty, Dog']);
    });

    it('Should count what the picked schema evaluates for "unevaluatedProperties"', () => {
      const closed = { ...mapped, unevaluatedProperties: false };
      expect(check(closed, { petType: 'dog', bark: true })).toEqual([]);
      expect(check(closed, { petType: 'dog', lives: 1, bark: true })).toEqual(['Unexpected key: lives']);
      expect(check(closed, { petType: 'cat', lives: 1, bark: true })).toEqual(['Unexpected key: bark']);
    });

    it('Should give the same results in standalone code', () => {
      const module = { exports: {} };
      // eslint-disable-next-line no-new-func -- loads the generated module
      new Function('module', 'exports', standaloneJsonSchema(mapped))(module, module.exports);
      expect(module.exports({ petType: 'dog', lives: 1, bark: true })).toEqual([]);
      expect(module.exports({ petType: 'bird' })).toEqual(['petType must be one of: cat, dog']);
    });

    it('Should throw on invalid mappings', () => {
      const at = 'Unsupported JSON Schema at #: "discriminator"';
      const withMapping = (mapping) => ({ ...api, discriminator: { propertyName: 'petType', mapping } });
      expect(() => compileJsonSchema(withMapping('Cat'))).toThrow(`${at}: "mapping" must be an object`);
      expect(() => compileJsonSchema(withMapping({ cat: 1 }))).toThrow(
        `${at}: "mapping"."cat" must be a reference or a schema name`
      );
      expect(() => compileJsonSchema(withMapping({ bird: '#/$defs/Bird' }))).toThrow(
        `${at}: "mapping"."bird" ("#/$defs/Bird") is not one of the "oneOf" schemas`
      );
      expect(() => compileJsonSchema(withMapping({ Cat: 'Dog' }))).toThrow(
        `${at}: the values of "petType" must be unique strings`
      );
      const inline = { ...api, oneOf: [...api.oneOf, { type: 'object' }], discriminator: { propertyName: 'petType' } };
      expect(() => compileJsonSchema(inline)).toThrow(`${at}: every "oneOf" schema needs a value of "petType"`);
    });
  });

  describe('Found in a plain oneOf', () => {
    // No discriminator: each schema gives "kind" its own value.
    const shapes = {
      type: 'object',
      oneOf: [
        { properties: { kind: { const: 'cat' }, lives: { type: 'integer' } }, required: ['kind', 'lives'] },
        { properties: { kind: { const: 'dog' }, bark: { type: 'boolean' } }, required: ['kind'] },
      ],
    };

    it('Should give the errors of the schema a known value picks', () => {
      expect(check(shapes, { kind: 'cat', lives: 1 })).toEqual([]);
      expect(check(shapes, { kind: 'cat' })).toEqual(['lives is mandatory']);
      expect(check(shapes, { kind: 'dog', bark: 1 })).toEqual(['bark must be a boolean']);
    });

    it('Should check other values as oneOf does, with its errors', () => {
      expect(check(shapes, { kind: 'cow' })).toEqual([
        'kind must be equal to cat',
        'lives is mandatory',
        'kind must be equal to dog',
      ]);
      expect(check(shapes, {})).toEqual(['kind is mandatory', 'lives is mandatory']);
      // Without "required", a schema can accept an object without the property.
      const optional = {
        oneOf: [{ properties: { kind: { const: 'a' } } }, { properties: { kind: { const: 'b' } }, required: ['kind'] }],
      };
      expect(check(optional, {})).toEqual([]);
      expect(check(optional, { kind: 'c' })).toEqual(['kind must be equal to a', 'kind must be equal to b']);
    });

    it('Should not be found when a value repeats or a schema gives none', () => {
      const repeated = {
        oneOf: [{ properties: { kind: { const: 'a' } } }, { properties: { kind: { enum: ['a', 'b'] } } }],
      };
      expect(check(repeated, { kind: 'a' })).toEqual([
        'Value must match exactly one schema, but matches more than one',
      ]);
      const missing = { oneOf: [{ properties: { kind: { const: 'a' } } }, { properties: { other: {} } }] };
      expect(check(missing, { kind: 'a' })).toEqual(['Value must match exactly one schema, but matches more than one']);
    });
  });

  describe('The required keys of additionalProperties: false', () => {
    it('Should reject a key only "required" names, unless a pattern matches it', () => {
      const schema = { properties: { a: {} }, required: ['y'], additionalProperties: false };
      expect(check(schema, { a: 1 })).toEqual(['y is mandatory']);
      expect(check(schema, { a: 1, y: 1 })).toEqual(['y is not allowed']);
      const patterned = {
        required: ['y1'],
        patternProperties: { '^y': { type: 'integer' } },
        additionalProperties: false,
      };
      expect(check(patterned, { y1: 1 })).toEqual([]);
      expect(check(patterned, { y1: 'x' })).toEqual(['y1 must be a number']);
      const typed = {
        required: ['y1', 'z'],
        patternProperties: { '^y': {} },
        additionalProperties: { type: 'string' },
      };
      expect(check(typed, { y1: 1, z: 1 })).toEqual(['z must be a string']);
    });
  });

  describe('OneOfType with a discriminator', () => {
    const type = new OneOfType({
      types: [
        new Schema({ kind: Values({ values: ['a'] }), n: Float() }),
        new Schema({ kind: Values({ values: ['b'] }) }),
      ],
      discriminator: {
        tag: 'kind',
        mapping: new Map([
          ['a', 0],
          ['b', 1],
        ]),
      },
    });

    it('Should validate like the compiled code', () => {
      expect(type.isValid({ kind: 'a', n: 1 })).toBe(true);
      expect(type.isValid({ kind: 'a' })).toBe(false);
      expect(type.isValid({ kind: 'c' })).toBe(false);
      expect(type.validate({ kind: 'c' }, 'pet')).toBe('pet.kind must be one of: a, b');
      expect(type.validate({})).toBe('kind is mandatory');
      expect(type.validate({ kind: 1 })).toBe('kind must be a string');
      expect(type.validate({ kind: 'b' })).toEqual([]);
    });

    it('Should give one value in the message of a single tag', () => {
      const single = new OneOfType({
        types: [new Schema({ kind: Values({ values: ['a'] }) })],
        discriminator: { tag: 'kind', mapping: new Map([['a', 0]]) },
      });
      expect(single.validate({ kind: 'x' })).toBe('kind must be equal to a');
    });

    it('Should check as oneOf an object whose tag picks nothing when the discriminator was found (auto)', () => {
      const found = new OneOfType({
        types: [new Schema({ kind: Values({ values: ['a'] }) }), new Schema({ kind: Values({ values: ['b'] }) })],
        discriminator: {
          tag: 'kind',
          mapping: new Map([
            ['a', 0],
            ['b', 1],
          ]),
          exact: true,
          auto: true,
        },
      });
      expect(found.isValid({ kind: 'a' })).toBe(true);
      expect(found.isValid({ kind: 'c' })).toBe(false);
      // The errors of oneOf, not an error about the tag.
      expect(toErrors(found.validate({ kind: 'c' }))).toEqual(['kind must be equal to a', 'kind must be equal to b']);
    });
  });
});
