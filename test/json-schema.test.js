const { compileJsonSchema, fromJsonSchema, Schema, toErrors } = require('../src');

const indexesSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['keys'],
    properties: {
      keys: {
        type: 'object',
        minProperties: 1,
        additionalProperties: { type: 'integer', enum: [1, -1] },
      },
      options: { type: 'object' },
    },
  },
};

const blockSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'parent', 'type', 'executor', 'aggregationType'],
  properties: {
    id: { type: 'integer' },
    parent: { type: 'integer' },
    groupField: { type: 'string' },
    aggregationType: { type: 'string', enum: ['count', 'avg', 'sum'] },
    names: { type: 'array', items: { type: 'string' } },
    formulas: { type: 'object', additionalProperties: { type: 'string' } },
    indexes: indexesSchema,
    type: { const: 'executor' },
    executor: { const: 'custom-stats' },
  },
};

const validBlock = { id: 2, parent: 1, type: 'executor', executor: 'custom-stats', aggregationType: 'count' };

describe('JSON Schema', () => {
  describe('fromJsonSchema', () => {
    it('Should build a Schema for object schemas', () => {
      expect(fromJsonSchema(blockSchema)).toBeInstanceOf(Schema);
    });

    it('Should throw on unsupported keywords', () => {
      expect(() => fromJsonSchema({ type: 'object', properties: { a: { maxDigits: 3 } } })).toThrow(
        'Unsupported JSON Schema keyword "maxDigits" at #.properties.a'
      );
    });

    it('Should throw on references that are not within the schema', () => {
      expect(() => fromJsonSchema({ type: 'object', properties: { a: { $ref: '#/defs/a' } } })).toThrow(
        'Unsupported JSON Schema "$ref": "#/defs/a" at #.properties.a: only references within the schema or to documents in the "schemas" option are supported'
      );
      expect(() => fromJsonSchema({ $ref: 'http://json-schema.org/draft-07/schema#' })).toThrow(
        'only references within the schema or to documents in the "schemas" option are supported'
      );
    });

    it('Should throw on unsupported types', () => {
      expect(() => fromJsonSchema({ type: 'date' })).toThrow('Unsupported JSON Schema type "date" at #');
    });

    it('Should throw when a keyword does not match the declared type', () => {
      expect(() => fromJsonSchema({ type: 'integer', minLength: 3 })).toThrow(
        'JSON Schema keyword "minLength" at # requires "type": "string"'
      );
    });

    it('Should handle properties named like Object.prototype properties', () => {
      // JSON.parse, as in an object literal __proto__ would set the prototype instead of a key.
      const validate = compileJsonSchema(
        JSON.parse(
          '{"type": "object", "required": ["__proto__", "toString", "constructor"], "properties": {"__proto__": {"type": "number"}}}'
        )
      );
      expect(validate({})).toEqual(['__proto__ is mandatory', 'toString is mandatory', 'constructor is mandatory']);
      expect(validate(JSON.parse('{"__proto__": "x", "toString": 1, "constructor": 2}'))).toEqual([
        '__proto__ must be a number',
      ]);
      expect(validate(JSON.parse('{"__proto__": 1, "toString": 1, "constructor": 2}'))).toEqual([]);
    });

    it('Should count string lengths in Unicode code points', () => {
      const validate = compileJsonSchema({ type: 'string', minLength: 2, maxLength: 2 });
      expect(validate('\u{1F4A9}\u{1F4A9}')).toEqual([]);
      expect(validate('\u{1F4A9}')).toEqual(['Value must be at least 2 characters long']);
      expect(fromJsonSchema({ maxLength: 1 }).isValid('\u{1F4A9}')).toBe(true);
    });

    describe('Keywords without type', () => {
      it('Should only apply to values of their type', () => {
        const validate = compileJsonSchema({ minLength: 2, maximum: 5 });
        expect(validate('a')).toEqual(['Value must be at least 2 characters long']);
        expect(validate('ab')).toEqual([]);
        expect(validate(7)).toEqual(['Value must be at most 5']);
        expect(validate(3)).toEqual([]);
        expect(validate(true)).toEqual([]);
        expect(validate([1])).toEqual([]);
        expect(validate(null)).toEqual([]);
      });

      it('Should apply object keywords only to objects', () => {
        const validate = compileJsonSchema({
          properties: { a: { minimum: 3 } },
          required: ['a'],
          additionalProperties: false,
        });
        expect(validate({ a: 5 })).toEqual([]);
        expect(validate({ a: 1, b: 2 })).toEqual(['a must be at least 3', 'Unexpected key: b']);
        expect(validate({})).toEqual(['a is mandatory']);
        expect(validate({ a: 'x' })).toEqual([]);
        expect(validate('not an object')).toEqual([]);
        expect(validate([])).toEqual([]);
      });

      it('Should apply array keywords only to arrays', () => {
        const validate = compileJsonSchema({ items: { type: 'integer' }, maxItems: 2, uniqueItems: true });
        expect(validate([1, 2])).toEqual([]);
        expect(validate([1, 'x'])).toEqual(['Value[1] must be a number']);
        expect(validate([1, 1])).toEqual(['Value must not have duplicate elements']);
        expect(validate([1, 2, 3])).toEqual(['Value must have at most 2 elements']);
        expect(validate({ 0: 'x' })).toEqual([]);
      });

      it('Should give the same results interpreted and compiled', () => {
        const json = { properties: { n: { minimum: 1 }, s: { pattern: '^a' } }, maxProperties: 2 };
        const type = fromJsonSchema(json);
        const validate = compileJsonSchema(json);
        [{ n: 0, s: 'b' }, { n: 2, s: 'a', x: 1 }, { n: 'x', s: 1 }, 1, 'x', null].forEach((value) => {
          expect(validate(value)).toEqual(type.isValid(value) ? [] : toErrors(type.errors(value)));
        });
      });
    });

    it('Should accept numeric keywords on integer types', () => {
      expect(() => fromJsonSchema({ type: 'integer', minimum: 0 })).not.toThrow();
    });

    it('Should ignore annotations', () => {
      const validate = compileJsonSchema({ type: 'string', title: 'Name', description: 'A name', format: 'email' });
      expect(validate('not an email')).toEqual([]);
    });
  });

  describe('compileJsonSchema', () => {
    const validate = compileJsonSchema(blockSchema);

    it('Should return no errors for a valid value', () => {
      expect(validate(validBlock)).toEqual([]);
    });

    it('Should report missing required properties', () => {
      const { parent, ...block } = validBlock;
      expect(validate(block)).toEqual(['parent is mandatory']);
    });

    it('Should not require properties that are not in required', () => {
      expect(validate({ ...validBlock, groupField: undefined })).toEqual([]);
    });

    it('Should report wrong types', () => {
      expect(validate({ ...validBlock, id: 'two' })).toEqual(['id must be a number']);
      expect(validate({ ...validBlock, id: 2.5 })).toEqual(['id must be an integer']);
      expect(validate({ ...validBlock, groupField: 3 })).toEqual(['groupField must be a string']);
    });

    it('Should reject null unless the schema allows it', () => {
      expect(validate({ ...validBlock, groupField: null })).toEqual(['groupField cannot be null']);
    });

    it('Should report additional properties when additionalProperties is false', () => {
      expect(validate({ ...validBlock, bogus: 'x' })).toEqual(['Unexpected key: bogus']);
    });

    it('Should validate enum and const values', () => {
      expect(validate({ ...validBlock, aggregationType: 'median' })).toEqual([
        'aggregationType must be one of: count, avg, sum',
      ]);
      expect(validate({ ...validBlock, executor: 'log' })).toEqual(['executor must be equal to custom-stats']);
    });

    it('Should validate array items', () => {
      expect(validate({ ...validBlock, names: [1, 'ok'] })).toEqual(['names[0] must be a string']);
    });

    it('Should validate additionalProperties schemas', () => {
      expect(validate({ ...validBlock, formulas: { a: 'x', b: 3 } })).toEqual(['formulas.b must be a string']);
    });

    it('Should validate nested objects inside arrays', () => {
      expect(validate({ ...validBlock, indexes: [{ keys: { a: 1, b: -1 }, options: { unique: true } }] })).toEqual([]);
      expect(validate({ ...validBlock, indexes: [{ keys: {} }] })).toEqual([
        'indexes[0].keys must have at least 1 properties',
      ]);
      expect(validate({ ...validBlock, indexes: [{ keys: { a: 2 } }] })).toEqual([
        'indexes[0].keys.a must be one of: 1, -1',
      ]);
      expect(validate({ ...validBlock, indexes: [{ options: {} }] })).toEqual(['indexes[0].keys is mandatory']);
      expect(validate({ ...validBlock, indexes: [{ keys: { a: 1 }, options: 'x' }] })).toEqual([
        'indexes[0].options must be an object',
      ]);
    });

    it('Should collect every error', () => {
      const { parent, ...block } = validBlock;
      expect(validate({ ...block, id: 'two', bogus: 'x' })).toEqual([
        'id must be a number',
        'parent is mandatory',
        'Unexpected key: bogus',
      ]);
    });

    it('Should report a non object root', () => {
      expect(validate('x')).toEqual(['Value must be an object']);
      expect(validate([])).toEqual(['Value must be an object']);
      expect(validate(undefined)).toEqual(['Value is mandatory']);
    });
  });

  describe('keywords', () => {
    it('Should support nullable types', () => {
      const validate = compileJsonSchema({ type: ['string', 'null'] });
      expect(validate(null)).toEqual([]);
      expect(validate('a')).toEqual([]);
      expect(validate(1)).toEqual(['Value must be a string']);
      expect(compileJsonSchema({ type: 'string', nullable: true })(null)).toEqual([]);
      expect(compileJsonSchema({ type: 'null' })(null)).toEqual([]);
      expect(compileJsonSchema({ type: 'null' })(1)).toEqual(['Value must be equal to null']);
    });

    it('Should support several types', () => {
      const validate = compileJsonSchema({ type: ['string', 'integer'] });
      expect(validate('a')).toEqual([]);
      expect(validate(1)).toEqual([]);
      expect(validate(true)).toEqual(['Value must be a string', 'Value must be a number']);
    });

    it('Should support string keywords', () => {
      const validate = compileJsonSchema({ type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-z]+$' });
      expect(validate('abc')).toEqual([]);
      expect(validate('a')).toEqual(['Value must be at least 2 characters long']);
      expect(validate('abcde')).toEqual(['Value must be at most 4 characters long']);
      expect(validate('AB')).toEqual(['Value does not match the required pattern']);
    });

    it('Should apply minLength to empty strings of optional properties', () => {
      const validate = compileJsonSchema({ type: 'object', properties: { name: { type: 'string', minLength: 1 } } });
      expect(validate({ name: '' })).toEqual(['name must be at least 1 characters long']);
      expect(validate({})).toEqual([]);
    });

    it('Should support number keywords, including zero bounds', () => {
      const validate = compileJsonSchema({ type: 'number', minimum: 0, maximum: 10 });
      expect(validate(0)).toEqual([]);
      expect(validate(-1)).toEqual(['Value must be at least 0']);
      expect(validate(11)).toEqual(['Value must be at most 10']);
      const exclusive = compileJsonSchema({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 10 });
      expect(exclusive(0)).toEqual(['Value must be greater than 0']);
      expect(exclusive(10)).toEqual(['Value must be less than 10']);
      expect(exclusive(5)).toEqual([]);
    });

    it('Should support array keywords', () => {
      const validate = compileJsonSchema({ type: 'array', minItems: 1, maxItems: 3, uniqueItems: true });
      expect(validate([1, 2])).toEqual([]);
      expect(validate([])).toEqual(['Value must have at least 1 elements']);
      expect(validate([1, 2, 3, 4])).toEqual(['Value must have at most 3 elements']);
      expect(validate([{ a: 1 }, { a: 1 }])).toEqual(['Value must not have duplicate elements']);
      expect(validate('x')).toEqual(['Value must be an array']);
    });

    it('Should support tuple items', () => {
      const validate = compileJsonSchema({ type: 'array', items: [{ type: 'string' }, { type: 'integer' }] });
      expect(validate(['a', 1])).toEqual([]);
      expect(validate(['a'])).toEqual([]);
      expect(validate([1, 'a'])).toEqual(['Value[0] must be a string', 'Value[1] must be a number']);
    });

    it('Should support maxProperties', () => {
      const validate = compileJsonSchema({ type: 'object', maxProperties: 1 });
      expect(validate({ a: 1 })).toEqual([]);
      expect(validate({ a: 1, b: 2 })).toEqual(['Value must have at most 1 properties']);
    });

    it('Should require keys listed in required but not in properties', () => {
      const validate = compileJsonSchema({ type: 'object', required: ['a'] });
      expect(validate({ a: null })).toEqual([]);
      expect(validate({})).toEqual(['a is mandatory']);
    });

    it('Should support anyOf', () => {
      const validate = compileJsonSchema({
        anyOf: [{ type: 'object', required: ['a'], properties: { a: { type: 'string' } } }, { type: 'integer' }],
      });
      expect(validate({ a: 'x' })).toEqual([]);
      expect(validate(3)).toEqual([]);
      expect(validate('x')).toEqual(['Value must be an object', 'Value must be a number']);
    });

    it('Should accept null in anyOf when a branch accepts it', () => {
      const validate = compileJsonSchema({ anyOf: [{ type: 'string' }, { type: 'null' }] });
      expect(validate(null)).toEqual([]);
    });

    it('Should support allOf', () => {
      const validate = compileJsonSchema({ allOf: [{ type: 'integer' }, { type: 'number', minimum: 5 }] });
      expect(validate(6)).toEqual([]);
      expect(validate(4)).toEqual(['Value must be at least 5']);
      expect(validate('x')).toEqual(['Value must be a number']);
    });

    it('Should support const objects with deep equality', () => {
      const validate = compileJsonSchema({ const: { a: [1, 2] } });
      expect(validate({ a: [1, 2] })).toEqual([]);
      expect(validate({ a: [2, 1] })).toEqual(['Value must be equal to {"a":[1,2]}']);
    });

    it('Should accept anything for true and empty schemas', () => {
      expect(compileJsonSchema(true)(null)).toEqual([]);
      expect(compileJsonSchema({})({ any: 'thing' })).toEqual([]);
      expect(compileJsonSchema({})(null)).toEqual([]);
    });
  });
});
