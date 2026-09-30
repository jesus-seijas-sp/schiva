const { Integer, Ref, compileJsonSchema, fromJsonSchema, toErrors } = require('../src');

// Errors of the interpreted type, of the compiled function and of the first-error function, for each value.
function results(json, values) {
  const type = fromJsonSchema(json);
  const all = compileJsonSchema(json);
  const first = compileJsonSchema(json, { allErrors: false });
  return values.map((value) => {
    const interpreted = type.isValid(value) ? [] : toErrors(type.errors(value));
    return { value, interpreted, compiled: all(value), first: first(value) };
  });
}

// Checks the interpreted and compiled results agree, and returns the errors of each value.
function errorsOf(json, values) {
  return results(json, values).map(({ value, interpreted, compiled, first }) => {
    expect({ value, errors: compiled }).toEqual({ value, errors: interpreted });
    expect({ value, errors: first }).toEqual({ value, errors: interpreted.slice(0, 1) });
    return compiled;
  });
}

describe('JSON Schema $ref', () => {
  it('Should follow JSON pointers to definitions', () => {
    const json = {
      type: 'object',
      properties: { age: { $ref: '#/definitions/adult' } },
      required: ['age'],
      definitions: { adult: { type: 'integer', minimum: 18 } },
    };
    expect(errorsOf(json, [{ age: 20 }, { age: 10 }, {}, { age: null }])).toEqual([
      [],
      ['age must be at least 18'],
      ['age is mandatory'],
      ['age cannot be null'],
    ]);
  });

  it('Should support recursive schemas through the root', () => {
    const json = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, children: { type: 'array', items: { $ref: '#' } } },
      additionalProperties: false,
    };
    const value = { id: 'a', children: [{ id: 'b', children: [{ id: 1 }] }, { id: 'c', other: 1 }, {}] };
    expect(errorsOf(json, [value, { id: 'a', children: [{ id: 'b', children: [] }] }])).toEqual([
      [
        'children[0].children[0].id must be a string',
        'Unexpected key: children[1].other',
        'children[2].id is mandatory',
      ],
      [],
    ]);
  });

  it('Should support references between definitions', () => {
    const json = {
      $ref: '#/definitions/list',
      definitions: {
        list: { type: 'array', items: { $ref: '#/definitions/item' } },
        item: { anyOf: [{ type: 'integer' }, { $ref: '#/definitions/list' }] },
      },
    };
    expect(
      errorsOf(json, [
        [1, [2, [3]]],
        [1, ['x']],
      ])
    ).toEqual([[], ['Value[1] must be a number', 'Value[1][0] must be a number', 'Value[1][0] must be an array']]);
  });

  it('Should unescape JSON pointer tokens', () => {
    const json = {
      type: 'object',
      properties: {
        tilde: { $ref: '#/definitions/tilde~0field' },
        slash: { $ref: '#/definitions/slash~1field' },
        percent: { $ref: '#/definitions/percent%25field' },
        quote: { $ref: '#/definitions/foo%22bar' },
      },
      definitions: {
        'tilde~field': { type: 'integer' },
        'slash/field': { type: 'integer' },
        'percent%field': { type: 'integer' },
        'foo"bar': { type: 'integer' },
      },
    };
    expect(
      errorsOf(json, [
        { tilde: 1, slash: 2, percent: 3, quote: 4 },
        { tilde: 'a', slash: 'b' },
      ])
    ).toEqual([[], ['tilde must be a number', 'slash must be a number']]);
  });

  it('Should resolve references against $id base URIs and anchors', () => {
    const json = {
      $id: 'http://example.com/root.json',
      type: 'object',
      properties: {
        a: { $ref: 'item.json' },
        b: { $ref: '#foo' },
        c: { $ref: 'http://example.com/nested/other.json' },
      },
      definitions: {
        item: { $id: 'item.json', type: 'integer' },
        anchored: { $id: '#foo', type: 'string' },
        nested: {
          $id: 'nested/',
          definitions: { other: { $id: 'other.json', type: 'boolean' } },
        },
      },
    };
    expect(
      errorsOf(json, [
        { a: 1, b: 'x', c: true },
        { a: 'x', b: 1, c: 1 },
      ])
    ).toEqual([[], ['a must be a number', 'b must be a string', 'c must be a boolean']]);
  });

  it('Should resolve pointers against URN base URIs', () => {
    const json = {
      $id: 'urn:uuid:deadbeef-1234-ffff-ffff-4321feebdaed',
      properties: { foo: { $ref: '#/definitions/bar' } },
      definitions: { bar: { type: 'string' } },
    };
    expect(errorsOf(json, [{ foo: 'x' }, { foo: 1 }])).toEqual([[], ['foo must be a string']]);
  });

  it('Should ignore every keyword next to $ref, $id included', () => {
    const json = {
      $id: 'http://example.com/base/',
      definitions: {
        reffed: { type: 'array' },
        inBase: { $id: 'foo.json', type: 'number' },
        elsewhere: { $id: 'http://example.com/foo.json', type: 'string' },
      },
      properties: {
        list: { $ref: '#/definitions/reffed', maxItems: 1 },
        foo: { $id: 'http://example.com/', $ref: 'foo.json' },
      },
    };
    expect(errorsOf(json, [{ list: [1, 2, 3], foo: 1 }, { foo: 'x' }])).toEqual([[], ['foo must be a number']]);
  });

  it('Should treat a property named $ref as a property', () => {
    const json = {
      properties: { $ref: { $ref: '#/definitions/text' } },
      definitions: { text: { type: 'string' } },
    };
    expect(errorsOf(json, [{ $ref: 'a' }, { $ref: 1 }])).toEqual([[], ['$ref must be a string']]);
  });

  it('Should accept null only when the referenced schema does', () => {
    const json = {
      anyOf: [{ $ref: '#/definitions/nullable' }, { type: 'integer' }],
      definitions: { nullable: { type: ['string', 'null'] } },
    };
    expect(errorsOf(json, [null, 'x', 1, true])).toEqual([
      [],
      [],
      [],
      ['Value must be a string', 'Value must be a number'],
    ]);
    expect(errorsOf({ $ref: '#/definitions/a', definitions: { a: { type: 'string' } } }, [null])).toEqual([
      ['Value cannot be null'],
    ]);
  });

  it('Should reject null when no referenced alternative accepts it', () => {
    const json = {
      anyOf: [{ $ref: '#/definitions/text' }, { type: 'integer' }],
      definitions: { text: { type: 'string' } },
    };
    expect(errorsOf(json, [null, 'x'])).toEqual([['Value cannot be null'], []]);
  });

  it('Should name fields of a referenced object at the root like an inline one', () => {
    const json = {
      $ref: '#/definitions/person',
      definitions: { person: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
    };
    expect(errorsOf(json, [{ id: 1 }, {}, 'x'])).toEqual([
      ['id must be a string'],
      ['id is mandatory'],
      ['Value must be an object'],
    ]);
  });

  it('Should reference boolean schema true', () => {
    expect(errorsOf({ $ref: '#/definitions/any', definitions: { any: true } }, [1, 'x', null])).toEqual([[], [], []]);
  });

  it('Should throw on references that cannot be resolved', () => {
    expect(() => fromJsonSchema({ $ref: '#/definitions/missing' })).toThrow(
      'Unsupported JSON Schema "$ref": "#/definitions/missing" at #: only references within the schema or to documents in the "schemas" option are supported'
    );
    expect(() => fromJsonSchema({ $ref: 'other.json' })).toThrow('only references within the schema');
    expect(() => fromJsonSchema({ $ref: 1 })).toThrow('"$ref" must be a string');
  });
});

describe('Ref', () => {
  it('Should validate with its target and pass the field name through', () => {
    const type = Ref({ target: Integer({ min: 18 }) });
    expect(type.validate(10, 'age')).toBe('age must be at least 18');
    expect(type.validate(undefined)).toBe('Value is mandatory');
    expect(type.validate(null)).toBe('Value cannot be null');
    expect(Ref({ target: Integer(), isMandatory: false }).isValid(undefined)).toBe(true);
  });

  it('Should throw when used before its target is set', () => {
    expect(() => Ref({ ref: '#/a' }).validate(1)).toThrow('Reference "#/a" is not resolved');
  });
});

describe('JSON Schema $ref to other documents', () => {
  // Errors of each value, after checking the interpreted type and the compiled functions agree.
  function remoteErrorsOf(json, schemas, values) {
    const type = fromJsonSchema(json, { schemas });
    const all = compileJsonSchema(json, { schemas });
    const first = compileJsonSchema(json, { schemas, allErrors: false });
    const isValid = compileJsonSchema(json, { schemas, errors: false });
    return values.map((value) => {
      const interpreted = type.isValid(value) ? [] : toErrors(type.errors(value));
      expect({ value, errors: all(value) }).toEqual({ value, errors: interpreted });
      expect({ value, errors: first(value) }).toEqual({ value, errors: interpreted.slice(0, 1) });
      expect({ value, valid: isValid(value) }).toEqual({ value, valid: interpreted.length === 0 });
      return interpreted;
    });
  }

  const remote = 'http://example.com/schemas/';

  it('Should resolve references to documents registered by URI', () => {
    const schemas = { [`${remote}integer.json`]: { type: 'integer' } };
    expect(remoteErrorsOf({ $ref: `${remote}integer.json` }, schemas, [1, 'a'])).toEqual([
      [],
      ['Value must be a number'],
    ]);
  });

  it('Should accept an array of documents with $id', () => {
    const schemas = [{ $id: `${remote}defs.json`, definitions: { code: { type: 'string', pattern: '^[A-Z]+$' } } }];
    const json = { properties: { code: { $ref: `${remote}defs.json#/definitions/code` } } };
    expect(remoteErrorsOf(json, schemas, [{ code: 'AB' }, { code: 'ab' }])).toEqual([
      [],
      ['code does not match the required pattern'],
    ]);
  });

  it('Should resolve relative references against the base of the schema and of each document', () => {
    const schemas = {
      [`${remote}nested/object.json`]: { type: 'object', properties: { name: { $ref: 'string.json' } } },
      [`${remote}nested/string.json`]: { type: 'string' },
    };
    const json = { $id: `${remote}root.json`, properties: { item: { $ref: 'nested/object.json' } } };
    expect(remoteErrorsOf(json, schemas, [{ item: { name: 'x' } }, { item: { name: 1 } }])).toEqual([
      [],
      ['item.name must be a string'],
    ]);
  });

  it('Should follow anchors, root references and base changes inside documents', () => {
    const schemas = [
      {
        $id: `${remote}tree.json`,
        type: 'object',
        properties: { value: { $ref: '#number' }, children: { type: 'array', items: { $ref: '#' } } },
        definitions: { number: { $id: '#number', type: 'number' } },
      },
    ];
    const value = { value: 1, children: [{ value: 2, children: [{ value: 'x' }] }] };
    expect(remoteErrorsOf({ $ref: `${remote}tree.json` }, schemas, [value])).toEqual([
      ['children[0].children[0].value must be a number'],
    ]);
  });

  it('Should validate schemas against the draft-07 meta-schema when it is registered', () => {
    const meta = {
      $id: 'http://json-schema.org/draft-07/schema#',
      type: ['object', 'boolean'],
      properties: { minLength: { type: 'integer', minimum: 0 }, type: { enum: ['string', 'number'] } },
    };
    const json = { $ref: 'http://json-schema.org/draft-07/schema#' };
    expect(remoteErrorsOf(json, [meta], [{ minLength: 1 }, true, { minLength: -1 }])[0]).toEqual([]);
    expect(fromJsonSchema(json, { schemas: [meta] }).isValid({ minLength: -1 })).toBe(false);
  });

  it('Should only convert the documents that are referenced', () => {
    const schemas = { [`${remote}a.json`]: { type: 'string' }, [`${remote}unsupported.json`]: { maxDigits: 3 } };
    expect(remoteErrorsOf({ $ref: `${remote}a.json` }, schemas, ['x'])).toEqual([[]]);
  });

  it('Should keep the schema, and the first document, for a URI registered twice', () => {
    const json = { $id: `${remote}root.json`, properties: { a: { $ref: 'other.json' } }, type: 'object' };
    const schemas = [
      { $id: `${remote}root.json`, type: 'string' },
      { $id: `${remote}other.json`, type: 'integer' },
      { $id: `${remote}other.json`, type: 'string' },
    ];
    expect(remoteErrorsOf(json, schemas, [{ a: 1 }, { a: 'x' }, 'x'])).toEqual([
      [],
      ['a must be a number'],
      ['Value must be an object'],
    ]);
  });

  it('Should keep the first anchor registered for a URI', () => {
    const json = {
      $id: `${remote}root.json`,
      properties: { a: { $ref: '#foo' } },
      definitions: { foo: { $id: '#foo', type: 'integer' } },
    };
    const schemas = [{ $id: `${remote}root.json`, definitions: { foo: { $id: '#foo', type: 'string' } } }];
    expect(remoteErrorsOf(json, schemas, [{ a: 1 }, { a: 'x' }])).toEqual([[], ['a must be a number']]);
  });

  it('Should throw on documents that are not registered and on invalid registrations', () => {
    expect(() => fromJsonSchema({ $ref: `${remote}missing.json` }, { schemas: {} })).toThrow(
      'or to documents in the "schemas" option are supported'
    );
    expect(() => fromJsonSchema({}, { schemas: { 'http://a.com/x.json#frag': {} } })).toThrow('without fragment');
    expect(() => fromJsonSchema({}, { schemas: { 'address#frag': {} } })).toThrow('without fragment');
    expect(() => fromJsonSchema({}, { schemas: [{ type: 'string' }] })).toThrow('is not a URI');
    expect(() => fromJsonSchema({}, { schemas: { '': {} } })).toThrow('is not a URI');
  });

  it('Should resolve relative document URIs as ajv and Fastify do', () => {
    const address = { $id: 'address', type: 'object', required: ['city'], properties: { city: { type: 'string' } } };
    const validate = compileJsonSchema(
      { type: 'object', properties: { home: { $ref: 'address#' }, work: { $ref: 'address' } } },
      { schemas: [address] }
    );
    expect(validate({ home: { city: 'X' }, work: { city: 'Y' } })).toEqual([]);
    expect(validate({ home: {}, work: { city: 1 } })).toEqual(['home.city is mandatory', 'work.city must be a string']);
    const byKey = compileJsonSchema(
      { $ref: 'defs.json#/$defs/id' },
      { schemas: { 'defs.json': { $defs: { id: { type: 'integer' } } } } }
    );
    expect(byKey(1.5)).toEqual(['Value must be an integer']);
    // A root with a relative "$id" of its own reaches them too.
    const rooted = compileJsonSchema(
      { $id: 'order', properties: { to: { $ref: 'address#' } } },
      { schemas: [address] }
    );
    expect(rooted({ to: {} })).toEqual(['to.city is mandatory']);
    expect(() => fromJsonSchema({}, { schemas: 'x' })).toThrow('expected an object of schemas by URI or an array');
  });
});
