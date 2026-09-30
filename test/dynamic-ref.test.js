const { compileJsonSchema, fromJsonSchema, toErrors } = require('../src');

const DRAFT_2019 = 'https://json-schema.org/draft/2019-09/schema';
const DRAFT_2020 = 'https://json-schema.org/draft/2020-12/schema';

// Every compiled mode and the uncompiled type give the same verdict and messages.
function check(schema, value, options = {}) {
  const errors = compileJsonSchema(schema, options)(value);
  expect(compileJsonSchema(schema, { ...options, allErrors: false })(value)).toEqual(errors.slice(0, 1));
  expect(compileJsonSchema(schema, { ...options, errors: false })(value)).toBe(errors.length === 0);
  const type = fromJsonSchema(schema, options);
  expect(type.isValid(value)).toBe(errors.length === 0);
  expect(errors.length === 0 ? [] : toErrors(type.errors(value))).toEqual(errors);
  return errors;
}

// A tree whose nodes are extended by the schema that uses it: the $dynamicRef of the generic tree points to the
// outermost schema with the "node" anchor, so a strict tree rejects unknown keys at every level.
const tree = {
  $schema: DRAFT_2020,
  $id: 'https://example.com/tree',
  $dynamicAnchor: 'node',
  type: 'object',
  properties: { data: true, children: { type: 'array', items: { $dynamicRef: '#node' } } },
};
const strictTree = {
  $schema: DRAFT_2020,
  $id: 'https://example.com/strict-tree',
  $dynamicAnchor: 'node',
  $ref: 'tree',
  unevaluatedProperties: false,
};

describe('Dynamic references', () => {
  describe('$dynamicRef (2020-12)', () => {
    it('Should resolve to the outermost schema with the dynamic anchor', () => {
      const schemas = { 'https://example.com/tree': tree };
      expect(check(strictTree, { children: [{ data: 1 }] }, { schemas })).toEqual([]);
      expect(check(strictTree, { children: [{ daat: 1 }] }, { schemas })).toEqual(['Unexpected key: children[0].daat']);
      // The generic tree on its own accepts any key.
      expect(check(tree, { children: [{ daat: 1 }] })).toEqual([]);
    });

    it('Should behave like $ref when the target has no dynamic anchor of that name', () => {
      const schema = {
        $schema: DRAFT_2020,
        $defs: { a: { $anchor: 'a', type: 'string' } },
        items: { $dynamicRef: '#a' },
      };
      expect(check(schema, ['x', 1])).toEqual(['Value[1] must be a string']);
      expect(check({ ...schema, items: { $dynamicRef: '#/$defs/a' } }, [1])).toEqual(['Value[0] must be a string']);
    });

    it('Should convert a target once for each scope it is reached in', () => {
      const generic = {
        $id: 'https://example.com/list',
        $defs: { item: { $dynamicAnchor: 'item', not: true } },
        type: 'array',
        items: { $dynamicRef: '#item' },
      };
      const numbers = {
        $schema: DRAFT_2020,
        $id: 'https://example.com/numbers',
        $defs: { item: { $dynamicAnchor: 'item', type: 'number' } },
        $ref: 'list',
      };
      const strings = {
        ...numbers,
        $id: 'https://example.com/strings',
        $defs: { item: { $dynamicAnchor: 'item', type: 'string' } },
      };
      const both = {
        $schema: DRAFT_2020,
        properties: { n: { $ref: 'https://example.com/numbers' }, s: { $ref: 'https://example.com/strings' } },
      };
      const schemas = [{ ...generic, $schema: DRAFT_2020 }, numbers, strings];
      expect(check(both, { n: [1], s: ['a'] }, { schemas })).toEqual([]);
      expect(check(both, { n: ['a'], s: [1] }, { schemas })).toEqual([
        'n[0] must be a number',
        's[0] must be a string',
      ]);
    });
  });

  describe('$recursiveRef (2019-09)', () => {
    it('Should resolve to the outermost resource with $recursiveAnchor', () => {
      const base = {
        $schema: DRAFT_2019,
        $id: 'https://example.com/base',
        $recursiveAnchor: true,
        type: 'object',
        additionalProperties: { $recursiveRef: '#' },
      };
      const extended = {
        $schema: DRAFT_2019,
        $id: 'https://example.com/extended',
        $recursiveAnchor: true,
        $ref: 'base',
        maxProperties: 1,
      };
      const schemas = [base];
      expect(check(extended, { a: { b: {} } }, { schemas })).toEqual([]);
      expect(check(extended, { a: { b: {}, c: {} } }, { schemas })).toEqual(['a must have at most 1 properties']);
      expect(check(base, { a: { b: {}, c: {} } })).toEqual([]);
    });

    it('Should behave like $ref without $recursiveAnchor', () => {
      const schema = {
        $schema: DRAFT_2019,
        properties: { n: { type: 'integer' }, next: { $recursiveRef: '#' } },
      };
      expect(check(schema, { n: 1, next: { n: 'x' } })).toEqual(['next.n must be a number']);
    });
  });

  describe('Drafts and vocabularies of each resource', () => {
    it('Should read each resource in the draft its $schema names', () => {
      const old = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: 'https://example.com/old',
        items: [{ type: 'string' }],
      };
      const schema = { $schema: DRAFT_2020, prefixItems: [{ $ref: 'https://example.com/old' }] };
      expect(check(schema, [[1]], { schemas: [old] })).toEqual(['Value[0][0] must be a string']);
    });

    it('Should take the draft and vocabularies of a registered meta-schema', () => {
      const meta = {
        $schema: DRAFT_2020,
        $id: 'https://example.com/meta/no-validation',
        $vocabulary: {
          'https://json-schema.org/draft/2020-12/vocab/core': true,
          'https://json-schema.org/draft/2020-12/vocab/applicator': true,
        },
      };
      const schema = {
        $schema: 'https://example.com/meta/no-validation',
        properties: { forbidden: false, n: { minimum: 10 } },
        prefixItems: [{ type: 'string' }],
      };
      // Validation keywords (minimum, type) are left out; applicators (properties, prefixItems) apply.
      expect(check(schema, { n: 1 }, { schemas: [meta] })).toEqual([]);
      expect(check(schema, { forbidden: 1 }, { schemas: [meta] })).toEqual(['forbidden is not allowed']);
    });

    it('Should throw on a required vocabulary it does not know, and ignore an optional one', () => {
      const meta = (isRequired) => ({
        $schema: DRAFT_2020,
        $id: 'https://example.com/meta/custom',
        $vocabulary: {
          'https://json-schema.org/draft/2020-12/vocab/core': true,
          'https://json-schema.org/draft/2020-12/vocab/validation': true,
          'https://example.com/vocab/custom': isRequired,
        },
      });
      const schema = { $schema: 'https://example.com/meta/custom', type: 'number' };
      expect(() => compileJsonSchema(schema, { schemas: [meta(true)] })).toThrow(
        'the meta-schema requires the vocabulary "https://example.com/vocab/custom"'
      );
      expect(check(schema, 'x', { schemas: [meta(false)] })).toEqual(['Value must be a number']);
    });
  });
});
