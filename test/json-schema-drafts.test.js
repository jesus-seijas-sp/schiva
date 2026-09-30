const { ArrayOf, Integer, compileJsonSchema } = require('../src');

const DRAFT_2019 = 'https://json-schema.org/draft/2019-09/schema';
const DRAFT_2020 = 'https://json-schema.org/draft/2020-12/schema';

// Every mode gives the same verdict, and the first error is the first of all errors.
function check(schema, value, options = {}) {
  const errors = compileJsonSchema(schema, options)(value);
  expect(compileJsonSchema(schema, { ...options, allErrors: false })(value)).toEqual(errors.slice(0, 1));
  expect(compileJsonSchema(schema, { ...options, errors: false })(value)).toBe(errors.length === 0);
  return errors;
}

describe('JSON Schema drafts', () => {
  describe('Choosing the draft', () => {
    it('Should read a schema without "$schema" as draft-07', () => {
      expect(() => compileJsonSchema({ prefixItems: [] })).toThrow(
        'Unsupported JSON Schema keyword "prefixItems" at #'
      );
    });

    it('Should read the draft from "$schema", with or without the empty fragment', () => {
      expect(check({ $schema: DRAFT_2020, prefixItems: [{ type: 'string' }] }, [1])).toEqual([
        'Value[0] must be a string',
      ]);
      expect(check({ $schema: `${DRAFT_2019}#`, minContains: 2, contains: { type: 'integer' } }, [1])).toEqual([
        'Value must contain at least 2 matching elements',
      ]);
    });

    it('Should read other "$schema" URIs as draft-07', () => {
      const schema = { $schema: 'https://example.com/my-dialect', type: 'string' };
      expect(check(schema, 1)).toEqual(['Value must be a string']);
    });

    it('Should let options.draft choose the draft', () => {
      expect(check({ prefixItems: [{ type: 'string' }] }, [1], { draft: '2020-12' })).toEqual([
        'Value[0] must be a string',
      ]);
      expect(() => compileJsonSchema({ $schema: DRAFT_2020, prefixItems: [] }, { draft: 'draft-07' })).toThrow(
        'Unsupported JSON Schema keyword "prefixItems"'
      );
      expect(() => compileJsonSchema({}, { draft: '2021' })).toThrow(
        'Unsupported JSON Schema option "draft": "2021" is not one of draft-04, draft-06, draft-07, 2019-09, 2020-12'
      );
    });
  });

  describe('Keywords of each draft', () => {
    it('Should throw on the keywords of later drafts in draft-07, and on references of the other draft', () => {
      expect(() => compileJsonSchema({ unevaluatedProperties: false })).toThrow(
        'Unsupported JSON Schema keyword "unevaluatedProperties" at #'
      );
      expect(() => compileJsonSchema({ $schema: DRAFT_2019, items: { $dynamicRef: '#meta' } })).toThrow(
        'Unsupported JSON Schema keyword "$dynamicRef" at #.items'
      );
      expect(() => compileJsonSchema({ $schema: DRAFT_2020, $recursiveRef: '#' })).toThrow(
        'Unsupported JSON Schema keyword "$recursiveRef" at #'
      );
      expect(() => compileJsonSchema({ $schema: DRAFT_2019, $recursiveRef: '#/$defs/a' })).toThrow(
        '"$recursiveRef" must be "#"'
      );
    });

    it('Should throw on keywords of other drafts', () => {
      expect(() => compileJsonSchema({ $schema: DRAFT_2020, items: [{}] })).toThrow(
        'in draft 2020-12 "items" is a schema; use "prefixItems"'
      );
      expect(() => compileJsonSchema({ $schema: DRAFT_2020, additionalItems: false })).toThrow(
        'Unsupported JSON Schema keyword "additionalItems"'
      );
      expect(() => compileJsonSchema({ $schema: DRAFT_2019, prefixItems: [] })).toThrow(
        'Unsupported JSON Schema keyword "prefixItems"'
      );
      expect(() => compileJsonSchema({ dependentRequired: {} })).toThrow(
        'Unsupported JSON Schema keyword "dependentRequired"'
      );
      expect(() => compileJsonSchema({ $anchor: 'a' })).toThrow('Unsupported JSON Schema keyword "$anchor"');
    });

    it('Should accept the content keywords as annotations', () => {
      const schema = { $schema: DRAFT_2020, contentMediaType: 'application/json', contentSchema: { type: 'object' } };
      expect(check(schema, 'not json')).toEqual([]);
    });
  });

  describe('Arrays', () => {
    it('Should check prefixItems and items after them in 2020-12', () => {
      const schema = { $schema: DRAFT_2020, prefixItems: [{ type: 'string' }], items: { type: 'integer' } };
      expect(check(schema, ['a', 1, 2])).toEqual([]);
      expect(check(schema, [1, 'b'])).toEqual(['Value[0] must be a string', 'Value[1] must be a number']);
      expect(check(schema, [])).toEqual([]);
    });

    it('Should check items for every element in 2020-12 without prefixItems', () => {
      expect(check({ $schema: DRAFT_2020, items: { type: 'integer' } }, [1, 'a'])).toEqual([
        'Value[1] must be a number',
      ]);
    });

    it('Should keep items arrays and additionalItems in 2019-09', () => {
      const schema = { $schema: DRAFT_2019, items: [{ type: 'string' }], additionalItems: false };
      expect(check(schema, ['a'])).toEqual([]);
      expect(check(schema, ['a', 1]).length).toBe(1);
    });

    it('Should check minContains and maxContains', () => {
      const schema = { $schema: DRAFT_2020, contains: { type: 'integer' }, minContains: 2, maxContains: 3 };
      expect(check(schema, [1, 'a'])).toEqual(['Value must contain at least 2 matching elements']);
      expect(check(schema, [1, 2, 'a'])).toEqual([]);
      expect(check(schema, [1, 2, 3, 4])).toEqual(['Value must contain at most 3 matching elements']);
      expect(check({ $schema: DRAFT_2020, contains: { type: 'integer' }, maxContains: 1 }, [1, 2])).toEqual([
        'Value must contain at most one matching element',
      ]);
    });

    it('Should accept arrays without matches when minContains is 0', () => {
      expect(check({ $schema: DRAFT_2020, contains: { type: 'integer' }, minContains: 0 }, [])).toEqual([]);
      expect(
        check({ $schema: DRAFT_2020, contains: { type: 'integer' }, minContains: 0, maxContains: 0 }, [1])
      ).toEqual(['Value must contain at most 0 matching elements']);
    });

    it('Should ignore minContains and maxContains without contains', () => {
      expect(check({ $schema: DRAFT_2020, minContains: 2, maxContains: 0 }, [1])).toEqual([]);
    });

    it('Should give minContains and maxContains to ArrayOf of the DSL', () => {
      const type = ArrayOf({ contains: Integer(), minContains: 2 });
      expect(type.compile()([1])).toEqual(['Value must contain at least 2 matching elements']);
      expect(type.validate([1])).toBe('Value must contain at least 2 matching elements');
      expect(type.isValid([1, 2])).toBe(true);
    });
  });

  describe('Objects', () => {
    it('Should check dependentRequired', () => {
      const schema = { $schema: DRAFT_2020, dependentRequired: { card: ['address'] } };
      expect(check(schema, { card: 1 })).toEqual(['address is mandatory when card is present']);
      expect(check(schema, { card: 1, address: 'x' })).toEqual([]);
      expect(() => compileJsonSchema({ $schema: DRAFT_2020, dependentRequired: { a: [1] } })).toThrow(
        'Unsupported JSON Schema at #.dependentRequired.a: expected property names'
      );
    });

    it('Should check dependentSchemas', () => {
      const schema = { $schema: DRAFT_2019, dependentSchemas: { card: { required: ['address'] } } };
      expect(check(schema, { card: 1 }).length).toBe(1);
      expect(check(schema, { card: 1, address: 'x' })).toEqual([]);
      expect(check(schema, {})).toEqual([]);
    });
  });

  describe('References', () => {
    it('Should resolve references to $defs in every draft', () => {
      const schema = { $defs: { id: { type: 'integer' } }, $ref: '#/$defs/id' };
      expect(check(schema, 'x')).toEqual(['Value must be a number']);
      expect(check({ ...schema, $schema: DRAFT_2020 }, 'x')).toEqual(['Value must be a number']);
    });

    it('Should resolve $anchor from 2019-09 on', () => {
      const schema = {
        $schema: DRAFT_2019,
        $defs: { id: { $anchor: 'id', type: 'integer' } },
        properties: { a: { $ref: '#id' } },
      };
      expect(check(schema, { a: 'x' })).toEqual(['a must be a number']);
    });

    it('Should resolve $dynamicAnchor as an anchor for $ref in 2020-12', () => {
      const schema = { $schema: DRAFT_2020, $defs: { id: { $dynamicAnchor: 'id', type: 'integer' } }, $ref: '#id' };
      expect(check(schema, 'x')).toEqual(['Value must be a number']);
    });

    it('Should apply the keywords next to $ref from 2019-09 on, and ignore them in draft-07', () => {
      const schema = { $defs: { id: { type: 'integer' } }, $ref: '#/$defs/id', maximum: 10 };
      expect(check(schema, 20)).toEqual([]);
      expect(check({ ...schema, $schema: DRAFT_2019 }, 20)).toEqual(['Value must be at most 10']);
      expect(check({ ...schema, $schema: DRAFT_2020 }, 5)).toEqual([]);
      expect(check({ ...schema, $schema: DRAFT_2020 }, 'x')).toEqual(['Value must be a number']);
    });

    it('Should accept null next to $ref only when both accept it', () => {
      const schema = { $schema: DRAFT_2020, $defs: { n: { type: ['integer', 'null'] } }, $ref: '#/$defs/n' };
      expect(check(schema, null)).toEqual([]);
      expect(check({ ...schema, type: 'integer' }, null).length).toBe(1);
    });

    it('Should use the $id next to $ref from 2019-09 on', () => {
      const schema = {
        $schema: DRAFT_2020,
        $defs: {
          a: { $id: 'https://example.com/a', $ref: 'b', minimum: 1 },
          b: { $id: 'https://example.com/b', type: 'integer' },
        },
        $ref: 'https://example.com/a',
      };
      expect(check(schema, 0)).toEqual(['Value must be at least 1']);
      expect(check(schema, 'x')).toEqual(['Value must be a number']);
    });
  });
});
