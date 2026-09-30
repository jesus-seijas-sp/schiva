const { compileJsonSchema, standaloneJsonSchema, fromJsonSchema, ajvKeywords, KeywordType } = require('../src');

// Every mode gives the same verdict, and the first error is the first of all errors.
function check(schema, value, options = {}) {
  const errors = compileJsonSchema(schema, options)(value);
  expect(compileJsonSchema(schema, { ...options, allErrors: false })(value)).toEqual(errors.slice(0, 1));
  expect(compileJsonSchema(schema, { ...options, errors: false })(value)).toBe(errors.length === 0);
  expect(fromJsonSchema(schema, options).isValid(value)).toBe(errors.length === 0);
  return errors;
}

const even = {
  keyword: 'even',
  type: 'integer',
  validate: (value, data) => !value || data % 2 === 0,
  message: 'must be even',
};

describe('Keywords of your own', () => {
  describe('validate and compile', () => {
    it('Should call validate with the value of the keyword and the data', () => {
      const options = { keywords: [even] };
      expect(check({ even: true }, 2, options)).toEqual([]);
      expect(check({ even: true }, 3, options)).toEqual(['Value must be even']);
      expect(check({ even: false }, 3, options)).toEqual([]);
      expect(check({ properties: { n: { even: true } } }, { n: 3 }, options)).toEqual(['n must be even']);
    });

    it('Should only check the values of its JSON types', () => {
      const options = { keywords: [even] };
      expect(check({ even: true }, 'x', options)).toEqual([]);
      expect(check({ even: true }, 2.5, options)).toEqual([]);
      expect(check({ even: true }, null, options)).toEqual([]);
    });

    it('Should check null when it has no type, or the type null', () => {
      const notNull = { keyword: 'notNull', validate: (value, data) => data !== null };
      expect(check({ notNull: true }, null, { keywords: [notNull] })).toEqual(['Value cannot be null']);
      expect(check({ notNull: true }, 1, { keywords: [notNull] })).toEqual([]);
      const nullable = { ...notNull, type: ['null', 'string'] };
      expect(check({ notNull: true }, null, { keywords: [nullable] })).toEqual(['Value cannot be null']);
    });

    it('Should call compile once, with the value of the keyword and the schema', () => {
      let calls = 0;
      const divisibleBy = {
        keyword: 'divisibleBy',
        type: 'number',
        compile: (n, parentSchema) => {
          calls += 1;
          expect(parentSchema.divisibleBy).toBe(n);
          return (data) => data % n === 0;
        },
        message: (n, data) => `must be divisible by ${n}, not ${data}`,
      };
      const validate = compileJsonSchema({ divisibleBy: 3 }, { keywords: [divisibleBy] });
      expect(validate(4)).toEqual(['Value must be divisible by 3, not 4']);
      expect(validate(6)).toEqual([]);
      expect(calls).toBe(1);
    });

    it('Should give error objects with its keyword', () => {
      const validate = compileJsonSchema(
        { properties: { n: { even: true } } },
        { keywords: [even], errors: 'objects' }
      );
      expect(validate({ n: 3 })).toEqual([
        { path: ['n'], pointer: '/n', keyword: 'even', params: {}, message: 'n must be even' },
      ]);
    });

    it('Should have a default message', () => {
      const keyword = { keyword: 'odd', validate: (value, data) => data % 2 === 1 };
      expect(check({ odd: true }, 2, { keywords: [keyword] })).toEqual(['Value must pass the "odd" keyword']);
    });

    it('Should apply next to "$ref" from draft 2019-09 on', () => {
      const schema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $defs: { int: { type: 'integer' } },
        $ref: '#/$defs/int',
        even: true,
      };
      expect(check(schema, 3, { keywords: [even] })).toEqual(['Value must be even']);
    });

    it('Should be ignored with strict: false only when not defined', () => {
      expect(check({ even: true }, 3, { strict: false })).toEqual([]);
      expect(check({ even: true }, 3, { strict: false, keywords: [even] })).toEqual(['Value must be even']);
    });

    it('Should not be written into standalone code', () => {
      expect(() => standaloneJsonSchema({ even: true }, { keywords: [even] })).toThrow(
        'Standalone code cannot contain the functions of the keyword "even"'
      );
    });
  });

  describe('macro', () => {
    const between = { keyword: 'between', type: 'number', macro: ([min, max]) => ({ minimum: min, maximum: max }) };

    it('Should check the schema the macro returns', () => {
      const options = { keywords: [between] };
      expect(check({ between: [1, 5] }, 3, options)).toEqual([]);
      expect(check({ between: [1, 5] }, 9, options)).toEqual(['Value must be at most 5']);
      expect(check({ between: [1, 5] }, 'x', options)).toEqual([]);
    });

    it('Should count what the schema it returns evaluates', () => {
      const withId = { keyword: 'withId', macro: () => ({ properties: { id: { type: 'integer' } } }) };
      const schema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        withId: true,
        unevaluatedProperties: false,
      };
      expect(check(schema, { id: 1 }, { keywords: [withId] })).toEqual([]);
      expect(check(schema, { id: 1, x: 1 }, { keywords: [withId] })).toEqual(['Unexpected key: x']);
    });

    it('Should be written into standalone code', () => {
      const module = { exports: {} };
      // eslint-disable-next-line no-new-func -- loads the generated module
      new Function('module', 'exports', standaloneJsonSchema({ between: [1, 5] }, { keywords: [between] }))(
        module,
        module.exports
      );
      expect(module.exports(9)).toEqual(['Value must be at most 5']);
    });
  });

  it('Should throw on invalid definitions', () => {
    const at = 'Unsupported JSON Schema option "keywords":';
    const compileWith =
      (definition, schema = {}) =>
      () =>
        compileJsonSchema(schema, { keywords: [definition] });
    expect(compileWith({ keyword: 'minimum', validate: () => true })).toThrow(
      `${at} "minimum" is a keyword of JSON Schema`
    );
    expect(compileWith({ keyword: 'x' })).toThrow(`${at} "x" needs one function: "validate", "compile" or "macro"`);
    expect(compileWith({ keyword: 'x', validate: () => true, macro: () => ({}) })).toThrow(
      `${at} "x" needs one function`
    );
    expect(compileWith({ keyword: 'x', type: 'date', validate: () => true })).toThrow(
      `${at} the "type" of "x" must be one or more of string, number, integer, boolean, object, array, null`
    );
    expect(compileWith({ keyword: 'x', type: 'boolean', macro: () => ({}) })).toThrow(
      `${at} the "type" of "x" must be one or more of object, array, string, number`
    );
    expect(compileWith({ keyword: 'x', validate: () => true, message: 1 })).toThrow(
      `${at} the "message" of "x" must be a string or a function`
    );
    expect(compileWith({ keyword: 'x', compile: () => 1 }, { x: 1 })).toThrow(
      'Unsupported JSON Schema: the "compile" of keyword "x" must return a function'
    );
  });

  it('Should keep names as annotations next to definitions', () => {
    expect(check({ even: true, 'x-note': 'a' }, 3, { keywords: ['x-note', even] })).toEqual(['Value must be even']);
  });

  describe('KeywordType', () => {
    it('Should validate like the compiled code', () => {
      const type = new KeywordType({
        keyword: 'even',
        check: (x) => x % 2 === 0,
        message: 'must be even',
        jsonTypes: ['number'],
      });
      expect(type.validate(3, 'n')).toBe('n must be even');
      expect(type.validate('x')).toBeUndefined();
      expect(type.isValid(4)).toBe(true);
      expect(() => new KeywordType({})).toThrow('KeywordType check must be a function or a regular expression');
      expect(new KeywordType({ check: /^a/, message: 'must start with a' }).validate('b')).toBe(
        'Value must start with a'
      );
    });
  });
});

describe('ajvKeywords()', () => {
  const options = { keywords: ajvKeywords() };

  it('Should give the keywords of ajv-keywords', () => {
    expect(ajvKeywords(['range', 'typeof']).map((definition) => definition.keyword)).toEqual(['range', 'typeof']);
    expect(ajvKeywords('range').map((definition) => definition.keyword)).toEqual(['range']);
    expect(() => ajvKeywords(['transform'])).toThrow('ajvKeywords: "transform" is not supported: it changes the data');
    expect(() => ajvKeywords(['select'])).toThrow('it needs $data references');
    expect(() => ajvKeywords(['nope'])).toThrow('ajvKeywords: unknown keyword "nope"');
  });

  it('typeof and instanceof', () => {
    expect(check({ typeof: 'number' }, 1, options)).toEqual([]);
    expect(check({ typeof: ['string', 'boolean'] }, 1, options)).toEqual(['Value must be of typeof string or boolean']);
    expect(check({ instanceof: 'Date' }, new Date(), options)).toEqual([]);
    expect(check({ instanceof: ['Map', 'Set'] }, {}, options)).toEqual(['Value must be an instance of Map or Set']);
    expect(() => compileJsonSchema({ typeof: 'date' }, options)).toThrow('"typeof" must be one of');
    expect(() => compileJsonSchema({ instanceof: 'Nope' }, options)).toThrow('"instanceof" must be one of');
  });

  it('range and exclusiveRange', () => {
    expect(check({ range: [1, 3] }, 4, options)).toEqual(['Value must be at most 3']);
    expect(check({ range: [1, 3] }, 'a', options)).toEqual([]);
    expect(check({ exclusiveRange: [1, 3] }, 3, options)).toEqual(['Value must be less than 3']);
    expect(check({ exclusiveRange: [1, 3] }, 1, { ...options, draft: 'draft-04' })).toEqual([
      'Value must be greater than 1',
    ]);
    expect(() => compileJsonSchema({ range: [3, 1] }, options)).toThrow('"range" must be [minimum, maximum]');
  });

  it('regexp', () => {
    expect(check({ regexp: '/^a/i' }, 'Abc', options)).toEqual([]);
    expect(check({ regexp: { pattern: '^a', flags: 'i' } }, 'b', options)).toEqual(['Value must match /^a/i']);
    // A global regular expression gives the same answer every time.
    const validate = compileJsonSchema({ regexp: '/a/g' }, options);
    expect([validate('a'), validate('a')]).toEqual([[], []]);
    expect(() => compileJsonSchema({ regexp: '^a' }, options)).toThrow('"regexp" must be a string "/pattern/flags"');
  });

  it('uniqueItemProperties', () => {
    expect(check({ uniqueItemProperties: ['id'] }, [{ id: 1 }, { id: 2 }], options)).toEqual([]);
    expect(check({ uniqueItemProperties: ['id'] }, [{ id: { a: 1 } }, { id: { a: 1 } }], options)).toEqual([
      'Value must have elements with unique id',
    ]);
    // As in ajv-keywords, a missing property is a value too.
    expect(check({ uniqueItemProperties: ['name'] }, [{ id: 1 }, { id: 2 }], options)).toEqual([
      'Value must have elements with unique name',
    ]);
  });

  it('allRequired, anyRequired, oneRequired, patternRequired and prohibited', () => {
    expect(check({ properties: { a: {}, b: {} }, allRequired: true }, { a: 1 }, options)).toEqual(['b is mandatory']);
    expect(check({ properties: { a: {} }, allRequired: false }, {}, options)).toEqual([]);
    expect(() => compileJsonSchema({ allRequired: true }, options)).toThrow(
      '"allRequired" must be next to "properties"'
    );
    expect(check({ anyRequired: ['a', 'b'] }, { b: 1 }, options)).toEqual([]);
    expect(check({ anyRequired: ['a', 'b'] }, {}, options)).toEqual(['a is mandatory', 'b is mandatory']);
    expect(check({ oneRequired: ['a', 'b'] }, { a: 1, b: 1 }, options)).toEqual([
      'Value must match exactly one schema, but matches more than one',
    ]);
    expect(check({ oneRequired: ['a', 'b'] }, 'x', options)).toEqual([]);
    expect(check({ patternRequired: ['^f'] }, { a: 1 }, options)).toEqual(['Value must have keys matching ^f']);
    expect(check({ prohibited: ['a'] }, { a: 1 }, options)).toEqual(['a is not allowed']);
    expect(check({ prohibited: ['a', 'b'] }, { c: 1 }, options)).toEqual([]);
  });

  it('deepProperties and deepRequired', () => {
    expect(check({ deepProperties: { '/a/b': { type: 'string' } } }, { a: { b: 1 } }, options)).toEqual([
      'a.b must be a string',
    ]);
    expect(check({ deepProperties: { '/a/1': { type: 'string' } } }, { a: [0, 'x'] }, options)).toEqual([]);
    expect(
      check({ deepProperties: { '/a/1': { type: 'string' } } }, { a: [0, 'x'] }, { ...options, draft: '2020-12' })
    ).toEqual([]);
    expect(check({ deepRequired: ['/a/b', '/c'] }, { a: {} }, options)).toEqual(['Value must have /a/b, /c']);
    expect(check({ deepRequired: ['/a/b'] }, { a: { b: 0 } }, options)).toEqual([]);
    expect(() => compileJsonSchema({ deepRequired: ['a'] }, options)).toThrow(
      '"deepRequired" must be a list of JSON pointers'
    );
  });
});
