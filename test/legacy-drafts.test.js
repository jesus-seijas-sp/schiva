const { compileJsonSchema, standaloneJsonSchema } = require('../src');

const DRAFT_04 = 'http://json-schema.org/draft-04/schema#';
const DRAFT_06 = 'http://json-schema.org/draft-06/schema#';

// Every mode gives the same verdict, and the first error is the first of all errors.
function check(schema, value, options = {}) {
  const errors = compileJsonSchema(schema, options)(value);
  expect(compileJsonSchema(schema, { ...options, allErrors: false })(value)).toEqual(errors.slice(0, 1));
  expect(compileJsonSchema(schema, { ...options, errors: false })(value)).toBe(errors.length === 0);
  return errors;
}

describe('Drafts 04 and 06', () => {
  describe('Choosing the draft', () => {
    it('Should read the draft from "$schema" or from the option "draft"', () => {
      const schema = { type: 'number', maximum: 3, exclusiveMaximum: true };
      expect(check({ $schema: DRAFT_04, ...schema }, 3)).toEqual(['Value must be less than 3']);
      expect(check(schema, 3, { draft: 'draft-04' })).toEqual(['Value must be less than 3']);
      expect(check({ $schema: DRAFT_06, contains: { type: 'string' } }, [1])).toEqual([
        'Value must contain at least one matching element',
      ]);
    });
  });

  describe('Draft-04', () => {
    it('Should make "minimum" and "maximum" exclusive with boolean "exclusiveMinimum" and "exclusiveMaximum"', () => {
      const schema = { type: 'integer', minimum: 1, exclusiveMinimum: true, maximum: 5, exclusiveMaximum: false };
      expect(check(schema, 1, { draft: 'draft-04' })).toEqual(['Value must be greater than 1']);
      expect(check(schema, 2, { draft: 'draft-04' })).toEqual([]);
      expect(check(schema, 5, { draft: 'draft-04' })).toEqual([]);
      expect(check(schema, 6, { draft: 'draft-04' })).toEqual(['Value must be at most 5']);
    });

    it('Should throw on numeric "exclusiveMaximum" in draft-04, and on boolean ones later', () => {
      expect(() => compileJsonSchema({ type: 'number', exclusiveMaximum: 3 }, { draft: 'draft-04' })).toThrow(
        '"exclusiveMaximum" must be a boolean in draft-04'
      );
      expect(() => compileJsonSchema({ type: 'number', exclusiveMinimum: true }, { draft: 'draft-06' })).toThrow(
        '"exclusiveMinimum" must be a number in draft-06'
      );
    });

    it('Should change the base URI with "id"', () => {
      const schema = {
        id: 'http://example.com/root.json',
        definitions: { a: { id: 'a.json', type: 'string' } },
        properties: { p: { $ref: 'a.json' } },
      };
      expect(check(schema, { p: 1 }, { draft: 'draft-04' })).toEqual(['p must be a string']);
    });

    it('Should register documents of the option "schemas" by their "id"', () => {
      const address = { $schema: DRAFT_04, id: 'http://example.com/address.json', type: 'object', required: ['city'] };
      const schema = { $schema: DRAFT_04, properties: { a: { $ref: 'http://example.com/address.json' } } };
      expect(check(schema, { a: {} }, { schemas: [address] })).toEqual(['a.city is mandatory']);
    });

    it('Should throw on the keywords that draft-04 does not have', () => {
      ['const', 'contains', 'propertyNames', 'if'].forEach((keyword) => {
        expect(() => compileJsonSchema({ [keyword]: {} }, { draft: 'draft-04' })).toThrow(
          `Unsupported JSON Schema keyword "${keyword}" at #`
        );
      });
    });
  });

  describe('Draft-06', () => {
    it('Should have "const", "contains" and "propertyNames" but not "if"', () => {
      expect(check({ const: 1 }, 2, { draft: 'draft-06' })).toEqual(['Value must be equal to 1']);
      expect(() => compileJsonSchema({ if: {}, then: {} }, { draft: 'draft-06' })).toThrow(
        'Unsupported JSON Schema keyword "if" at #'
      );
    });

    it('Should ignore the keywords next to "$ref", as draft-07 does', () => {
      const schema = {
        definitions: { a: { type: 'string' } },
        properties: { p: { $ref: '#/definitions/a', minLength: 5 } },
      };
      expect(check(schema, { p: 'ab' }, { draft: 'draft-06' })).toEqual([]);
    });
  });

  describe('Formats', () => {
    it('Should check "hostname" as RFC 1123 alone up to draft-06', () => {
      const schema = { type: 'string', format: 'hostname' };
      expect(check(schema, 'ab--cd.example', { draft: 'draft-04', formats: true })).toEqual([]);
      expect(check(schema, 'ab--cd.example', { draft: 'draft-06', formats: true })).toEqual([]);
      expect(check(schema, 'ab--cd.example', { formats: true })).toEqual(['Value must be a valid hostname']);
      expect(check(schema, '-a.example', { draft: 'draft-04', formats: true })).toEqual([
        'Value must be a valid hostname',
      ]);
    });

    it('Should write the RFC 1123 check into standalone code', () => {
      const code = standaloneJsonSchema({ type: 'string', format: 'hostname' }, { draft: 'draft-04', formats: true });
      expect(code).toContain('function isRfc1123Hostname(');
    });
  });
});
