const { compileJsonSchema } = require('../src');

const DRAFT_2020 = 'https://json-schema.org/draft/2020-12/schema';

describe('Options "strict" and "keywords"', () => {
  it('Should throw on unknown keywords by default', () => {
    expect(() => compileJsonSchema({ type: 'string', 'x-internal': true })).toThrow(
      'Unsupported JSON Schema keyword "x-internal" at #'
    );
  });

  it('Should read the keywords the option "keywords" names as annotations', () => {
    const schema = { type: 'string', 'x-internal': true, example: 'a' };
    const validate = compileJsonSchema(schema, { keywords: ['x-internal', 'example'] });
    expect(validate(1)).toEqual(['Value must be a string']);
    expect(validate('a')).toEqual([]);
  });

  it('Should keep a reference alone when the keywords next to it are declared annotations', () => {
    const schema = {
      $schema: DRAFT_2020,
      $defs: { a: { type: 'string' } },
      properties: { p: { $ref: '#/$defs/a', 'x-note': 'text' } },
    };
    expect(compileJsonSchema(schema, { keywords: ['x-note'] })({ p: 1 })).toEqual(['p must be a string']);
  });

  it('Should ignore unknown keywords with strict: false', () => {
    const validate = compileJsonSchema({ type: 'string', 'x-internal': true, foo: { bar: 1 } }, { strict: false });
    expect(validate(1)).toEqual(['Value must be a string']);
    expect(compileJsonSchema({ $async: true, errorMessage: 'x' }, { strict: false })(1)).toEqual([]);
  });

  it('Should ignore, with strict: false, the keywords a "type" excludes and the ones of other drafts', () => {
    expect(compileJsonSchema({ type: 'string', minimum: 1 }, { strict: false })('a')).toEqual([]);
    const schema = { prefixItems: [{ type: 'string' }], minContains: 2, contains: { type: 'string' } };
    expect(compileJsonSchema(schema, { strict: false, draft: 'draft-07' })([1, 'a'])).toEqual([]);
    expect(compileJsonSchema({ const: 1 }, { strict: false, draft: 'draft-04' })(2)).toEqual([]);
    // The keywords of other drafts do not count for null either.
    expect(
      compileJsonSchema({ const: 1, type: ['null', 'string'] }, { strict: false, draft: 'draft-04' })(null)
    ).toEqual([]);
  });

  it('Should ignore unknown keywords next to a reference with strict: false', () => {
    const schema = {
      $schema: DRAFT_2020,
      $defs: { a: { type: 'string' } },
      properties: { p: { $ref: '#/$defs/a', 'x-y': 1 } },
    };
    expect(compileJsonSchema(schema, { strict: false })({ p: 1 })).toEqual(['p must be a string']);
  });

  it('Should still throw on errors that are not unknown keywords with strict: false', () => {
    expect(() => compileJsonSchema({ type: 'text' }, { strict: false })).toThrow('Unsupported JSON Schema type "text"');
    expect(() => compileJsonSchema({ $schema: DRAFT_2020, items: [] }, { strict: false })).toThrow(
      'in draft 2020-12 "items" is a schema'
    );
  });

  it('Should throw on invalid options', () => {
    expect(() => compileJsonSchema({}, { strict: 'no' })).toThrow(
      'Unsupported JSON Schema option "strict": expected true or false'
    );
    expect(() => compileJsonSchema({}, { keywords: 'x-a' })).toThrow(
      'Unsupported JSON Schema option "keywords": expected a list of keyword names or definitions'
    );
    expect(() => compileJsonSchema({}, { keywords: [1] })).toThrow(
      'Unsupported JSON Schema option "keywords": expected keyword names, or definitions with "keyword"'
    );
  });
});
