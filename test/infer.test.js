const schiva = require('../src');

const { inferJsonSchema, inferSchemaCode, compileJsonSchema } = schiva;

// Runs the code inferSchemaCode() writes, with the names of schiva, and gives its schema.
const names = Object.keys(schiva).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
function schemaOfCode(code) {
  const body = code.replace(/^const \{[^}]*\} = require\('schiva'\);/, '');
  // eslint-disable-next-line no-new-func -- the code is the library's own output
  return new Function(...names, `${body}\nreturn schema;`)(...names.map((name) => schiva[name]));
}

const RFC = '2026-09-30T10:00:00Z';

describe('inferJsonSchema', () => {
  it('Should infer types, properties, required keys and formats from one sample', () => {
    expect(
      inferJsonSchema([{ id: 1, name: 'Ann', score: 9.5, ok: true, tags: ['a'], at: RFC, mail: 'a@b.co', none: null }])
    ).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        score: { type: 'number' },
        ok: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        at: { type: 'string', format: 'date-time' },
        mail: { type: 'string', format: 'email' },
        none: {},
      },
      required: ['id', 'name', 'score', 'ok', 'tags', 'at', 'mail', 'none'],
    });
  });

  it('Should merge several samples: optional keys, nullable values, integer and number, several types', () => {
    const schema = inferJsonSchema([
      { a: 1, b: 'x', c: { d: 1 }, e: 1 },
      { a: 1.5, c: null, e: 'one' },
    ]);
    expect(schema.properties).toEqual({
      a: { type: 'number' },
      b: { type: 'string' },
      c: { type: ['object', 'null'], properties: { d: { type: 'integer' } }, required: ['d'] },
      e: { type: ['string', 'integer'] },
    });
    expect(schema.required).toEqual(['a', 'c', 'e']);
  });

  it('Should merge the elements of arrays, and leave the elements of empty arrays open', () => {
    const schema = inferJsonSchema([
      {
        lines: [
          { sku: 'A', qty: 1 },
          { sku: 'B', note: 'x' },
        ],
      },
      { lines: [], empty: [] },
    ]);
    expect(schema.properties.lines.items).toEqual({
      type: 'object',
      properties: { sku: { type: 'string' }, qty: { type: 'integer' }, note: { type: 'string' } },
      required: ['sku'],
    });
    expect(schema.properties.empty).toEqual({ type: 'array' });
  });

  it('Should keep a format only when every string matches it, and detect the usual ones', () => {
    const formatOf = (values) => inferJsonSchema(values).format;
    expect(formatOf([RFC, '2026-01-01T00:00:00.5+02:00'])).toBe('date-time');
    expect(formatOf(['2026-09-30'])).toBe('date');
    expect(formatOf(['10:00:00Z'])).toBe('time');
    expect(formatOf(['0b4a7c1e-1d2f-4e5a-9b8c-7d6e5f4a3b2c'])).toBe('uuid');
    expect(formatOf(['10.0.0.1'])).toBe('ipv4');
    expect(formatOf(['::1'])).toBe('ipv6');
    expect(formatOf(['https://example.com/a'])).toBe('uri');
    expect(formatOf(['note:something'])).toBeUndefined();
    expect(formatOf(['example'])).toBeUndefined();
    expect(formatOf(['2026-09-30', 'soon'])).toBeUndefined();
    expect(inferJsonSchema(['a@b.co'], { formats: false }).format).toBeUndefined();
  });

  it('Should take the options closed and draft', () => {
    const schema = inferJsonSchema([{ a: { b: 1 } }], { closed: true, draft: 'draft-07' });
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.a.additionalProperties).toBe(false);
    expect(compileJsonSchema(schema)({ a: { b: 1, c: 2 } })).toEqual(['Unexpected key: a.c']);
    // draft-04 does not allow an empty "required", which is then left out.
    expect(inferJsonSchema([{ a: 1 }, {}], { draft: 'draft-04' })).not.toHaveProperty('required');
  });

  it('Should throw on what is not a list of JSON values', () => {
    expect(() => inferJsonSchema({ a: 1 })).toThrow('expected a non-empty array of sample values');
    expect(() => inferJsonSchema([])).toThrow('expected a non-empty array of sample values');
    expect(() => inferJsonSchema([{ a: { b: () => 1 } }])).toThrow('a.b is a function, not a JSON value');
    expect(() => inferJsonSchema([{ at: new Date(0) }])).toThrow('at is a Date (use its ISO string)');
    expect(() => inferJsonSchema([{ n: NaN }])).toThrow('NaN at n is not a JSON value');
    expect(() => inferJsonSchema([1], { draft: '2021' })).toThrow('"2021" is not one of draft-04');
    // Keys whose value is undefined are absent, as in JSON.
    expect(inferJsonSchema([{ a: 1, b: undefined }]).properties).toEqual({ a: { type: 'integer' } });
  });
});

describe('inferSchemaCode', () => {
  it('Should write the DSL of the same schema, with its imports', () => {
    const code = inferSchemaCode([
      { id: 1, name: 'Ann', tags: ['a'], at: RFC, address: { city: 'X' }, 'x-ref': 1 },
      { id: 2, name: 'Bob', tags: [], at: RFC, address: null, extra: 'e' },
    ]);
    expect(code).toBe(`const { ArrayOf, Integer, Schema, String } = require('schiva');

const schema = new Schema({
  id: Integer(),
  name: String(),
  tags: ArrayOf({ type: String() }),
  at: String({ format: 'date-time' }),
  address: new Schema({
    city: String(),
  }, { isNullable: true }),
  'x-ref': Integer({ isMandatory: false }),
  extra: String({ isMandatory: false }),
});
`);
  });

  it('Should take the options name, module and closed', () => {
    const esm = inferSchemaCode([{ a: 1 }], { name: 'order', module: 'esm', closed: true });
    expect(esm).toBe(
      "import { ClosedSchema, Integer } from 'schiva';\n\nconst order = new ClosedSchema({\n  a: Integer(),\n});\n"
    );
    expect(inferSchemaCode([true], { module: 'none' })).toBe('const schema = Boolean();\n');
    expect(inferSchemaCode([null])).toBe(
      "const { Any } = require('schiva');\n\nconst schema = Any({ isNullable: true });\n"
    );
    expect(inferSchemaCode([[]], { module: 'none' })).toBe('const schema = ArrayOf();\n');
    expect(inferSchemaCode([1, 'a', null], { module: 'none' })).toBe(
      'const schema = AnyOf({ types: [String(), Integer()], isNullable: true });\n'
    );
    expect(inferSchemaCode([{ "it's": 1 }], { module: 'none' })).toContain("'it\\'s': Integer(),");
    expect(() => inferSchemaCode([1], { name: 'a-b' })).toThrow('"a-b" is not a JavaScript identifier');
    expect(() => inferSchemaCode([1], { module: 'amd' })).toThrow('"amd" is not one of commonjs, esm, none');
  });
});

// Random JSON values, from a seeded generator so failures repeat.
function randomGenerator(seed) {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const pick = (items) => items[Math.floor(next() * items.length)];
  const strings = [
    '',
    'a',
    'text',
    RFC,
    '2026-09-30',
    'a@b.co',
    '0b4a7c1e-1d2f-4e5a-9b8c-7d6e5f4a3b2c',
    'https://x.io',
  ];
  const keys = ['a', 'b', 'c', 'x-y', 'id'];
  function value(depth) {
    const kind = pick(
      depth > 2 ? ['null', 'bool', 'int', 'num', 'str'] : ['null', 'bool', 'int', 'num', 'str', 'arr', 'obj', 'obj']
    );
    switch (kind) {
      case 'null':
        return null;
      case 'bool':
        return next() < 0.5;
      case 'int':
        return Math.floor(next() * 100) - 50;
      case 'num':
        return next() * 100 - 50;
      case 'str':
        return pick(strings);
      case 'arr':
        return Array.from({ length: Math.floor(next() * 4) }, () => value(depth + 1));
      default:
        return Object.fromEntries(keys.filter(() => next() < 0.5).map((key) => [key, value(depth + 1)]));
    }
  }
  return { value, next };
}

describe('Inferred schemas', () => {
  it('Should accept every sample, and the JSON Schema and the DSL should agree on other values', () => {
    const random = randomGenerator(7);
    for (let round = 0; round < 300; round += 1) {
      const samples = Array.from({ length: 1 + Math.floor(random.next() * 4) }, () => random.value(0));
      const closed = round % 3 === 0;
      const json = compileJsonSchema(inferJsonSchema(samples, { closed }), { formats: true });
      const dsl = schemaOfCode(inferSchemaCode(samples, { closed })).compile();
      samples.forEach((sample) => {
        expect([round, json(sample)]).toEqual([round, []]);
        expect([round, dsl(sample)]).toEqual([round, []]);
      });
      for (let i = 0; i < 10; i += 1) {
        const other = random.value(0);
        expect([round, other, dsl(other).length === 0]).toEqual([round, other, json(other).length === 0]);
      }
    }
  });
});
