const { compileJsonSchema, standaloneJsonSchema, fromJsonSchema, toErrors } = require('../src');

// Validates a copy of `data` in every mode (and with the interpreter and standalone code): they give the same verdict
// and, on valid data, the same data. Returns the errors and the data.
function run(schema, data, options = { coerceTypes: true }) {
  const copy = () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data)));
  let value = copy();
  const errors = compileJsonSchema(schema, options)(value);
  const result = { errors, data: value };
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func -- loads the generated module
  new Function('module', 'exports', standaloneJsonSchema(schema, options))(module, module.exports);
  const others = [
    (d) => compileJsonSchema(schema, { ...options, errors: false })(d),
    (d) => compileJsonSchema(schema, { ...options, allErrors: false })(d).length === 0,
    (d) => fromJsonSchema(schema, options).isValid(d),
    (d) => module.exports(d).length === 0,
  ];
  others.forEach((fn) => {
    value = copy();
    expect(fn(value)).toBe(errors.length === 0);
    if (errors.length === 0) {
      expect(value).toEqual(result.data);
    }
  });
  return result;
}

const property = (schema, value, options) => run({ properties: { v: schema } }, { v: value }, options);

describe('coerceTypes', () => {
  it('Should convert to numbers and integers', () => {
    expect(property({ type: 'number' }, '1.5').data).toEqual({ v: 1.5 });
    expect(property({ type: 'number' }, ' 2 ').data).toEqual({ v: 2 });
    expect(property({ type: 'number' }, true).data).toEqual({ v: 1 });
    expect(property({ type: 'number' }, null).data).toEqual({ v: 0 });
    expect(property({ type: 'number' }, '').errors).toEqual(['v must be a number']);
    expect(property({ type: 'integer' }, '2.0').data).toEqual({ v: 2 });
    expect(property({ type: 'integer' }, '1.5').errors).toEqual(['v must be a number']);
    expect(property({ type: 'number' }, 'Infinity').errors).toEqual(['v must be a number']);
  });

  it('Should convert to strings, booleans and null', () => {
    expect(property({ type: 'string' }, 12).data).toEqual({ v: '12' });
    expect(property({ type: 'string' }, false).data).toEqual({ v: 'false' });
    expect(property({ type: 'string' }, null).data).toEqual({ v: '' });
    expect(property({ type: 'boolean' }, 'true').data).toEqual({ v: true });
    expect(property({ type: 'boolean' }, 0).data).toEqual({ v: false });
    expect(property({ type: 'boolean' }, null).data).toEqual({ v: false });
    expect(property({ type: 'boolean' }, 'yes').errors).toEqual(['v must be a boolean']);
    expect(property({ type: 'null' }, '').data).toEqual({ v: null });
    expect(property({ type: 'null' }, 0).data).toEqual({ v: null });
  });

  it('Should try the types in the order "type" lists them, and leave values of one of them', () => {
    expect(property({ type: ['number', 'null'] }, '').data).toEqual({ v: null });
    expect(property({ type: ['null', 'number'] }, 0).data).toEqual({ v: 0 });
    expect(property({ type: ['boolean', 'number'] }, '1').data).toEqual({ v: 1 });
    expect(property({ type: ['number', 'boolean'] }, 'true').data).toEqual({ v: true });
  });

  it('Should take nullable: true as a type null after the others, as ajv does', () => {
    expect(property({ type: 'string', nullable: true }, null).data).toEqual({ v: null });
    expect(property({ type: 'number', nullable: true }, null).data).toEqual({ v: null });
    expect(property({ type: 'boolean', nullable: true }, null).data).toEqual({ v: null });
    expect(property({ type: 'string', nullable: true }, 5).data).toEqual({ v: '5' });
    expect(property({ type: 'number', nullable: true }, '').data).toEqual({ v: null });
    expect(property({ type: 'number', nullable: true }, false).data).toEqual({ v: 0 });
    expect(property({ type: 'array', items: { type: 'number' }, nullable: true }, null).data).toEqual({ v: null });
    expect(
      property({ type: 'array', items: { type: 'number' }, nullable: true }, '3', { coerceTypes: 'array' }).data
    ).toEqual({ v: [3] });
  });

  it('Should check the converted value', () => {
    expect(property({ type: 'integer', minimum: 5 }, '3')).toEqual({
      errors: ['v must be at least 5'],
      data: { v: 3 },
    });
  });

  it('Should convert elements, pattern and additional properties, and through $ref and allOf', () => {
    expect(run({ type: 'array', items: { type: 'integer' } }, ['1', '2']).data).toEqual([1, 2]);
    expect(run({ type: 'array', items: [{ type: 'integer' }, { type: 'boolean' }] }, ['1', 'false']).data).toEqual([
      1,
      false,
    ]);
    expect(run({ patternProperties: { '^n': { type: 'number' } } }, { n1: '1' }).data).toEqual({ n1: 1 });
    expect(run({ additionalProperties: { type: 'number' } }, { x: '1' }).data).toEqual({ x: 1 });
    expect(
      run({ definitions: { n: { type: 'number' } }, properties: { v: { $ref: '#/definitions/n' } } }, { v: '4' }).data
    ).toEqual({
      v: 4,
    });
    expect(property({ allOf: [{ type: 'integer' }] }, '3').data).toEqual({ v: 3 });
  });

  it('Should convert the value validated for the validation only', () => {
    expect(run({ type: 'integer', minimum: 1 }, '5').errors).toEqual([]);
    expect(run({ type: 'integer', minimum: 1 }, '0').errors).toEqual(['Value must be at least 1']);
    expect(run({ type: 'number' }, undefined).errors).toEqual(['Value is mandatory']);
  });

  it('Should convert to and from arrays with coerceTypes: array', () => {
    const options = { coerceTypes: 'array' };
    expect(property({ type: 'array', items: { type: 'number' } }, '7', options).data).toEqual({ v: [7] });
    expect(property({ type: 'number' }, ['1'], options).data).toEqual({ v: 1 });
    expect(property({ type: 'string' }, ['x'], options).data).toEqual({ v: 'x' });
    expect(property({ type: 'number' }, [1, 2], options).errors).toEqual(['v must be a number']);
    // Without it, arrays are left as they are.
    expect(property({ type: 'number' }, ['1']).errors).toEqual(['v must be a number']);
  });

  it('Should not convert without a type, or without the option', () => {
    expect(property({ minimum: 1 }, '5').data).toEqual({ v: '5' });
    const data = { v: '5' };
    expect(compileJsonSchema({ properties: { v: { type: 'number' } } })(data)).toEqual(['v must be a number']);
    expect(data).toEqual({ v: '5' });
  });

  it('Should assign defaults before converting them', () => {
    const schema = { properties: { v: { type: 'integer', default: '3' } } };
    expect(run(schema, {}, { coerceTypes: true, useDefaults: true }).data).toEqual({ v: 3 });
  });

  it('Should leave values of the other types of the list, and follow references that refer to themselves', () => {
    expect(property({ type: ['object', 'string'] }, 1).data).toEqual({ v: '1' });
    expect(property({ type: ['object', 'string'] }, { a: 1 }).data).toEqual({ v: { a: 1 } });
    const loop = {
      definitions: { a: { $ref: '#/definitions/b' }, b: { $ref: '#/definitions/a' } },
      properties: { v: {} },
    };
    expect(run(loop, { v: '1' }).data).toEqual({ v: '1' });
    expect(property({ allOf: [{ minimum: 1 }, { type: 'integer' }] }, '3').data).toEqual({ v: 3 });
  });

  it('Should convert the value validated in the interpreter too', () => {
    const type = fromJsonSchema({ type: 'integer', minimum: 1 }, { coerceTypes: true });
    expect(toErrors(type.validate('0'))).toEqual(['Value must be at least 1']);
    expect(toErrors(type.errors('0'))).toEqual(['Value must be at least 1']);
    expect(type.isValid('2')).toBe(true);
  });

  it('Should throw on an invalid option', () => {
    expect(() => compileJsonSchema({}, { coerceTypes: 'yes' })).toThrow(
      'Unsupported JSON Schema option "coerceTypes": expected true, false or \'array\''
    );
  });
});
