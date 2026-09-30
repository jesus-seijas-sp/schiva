const { Float, Integer, compileJsonSchema } = require('../src');

describe('Float Type', () => {
  it('Should allow undefined if not mandatory', () => {
    const type = Float({ isMandatory: false });
    expect(type.validate(undefined)).toBeUndefined();
  });

  it('Should return an error if mandatory and value is undefined', () => {
    const type = Float();
    expect(type.validate(undefined)).toBe('Value is mandatory');
  });

  it('Should return an error if value is not a number', () => {
    const type = Float();
    expect(type.validate('')).toBe('Value must be a number');
  });

  it('Should return an error if value is NaN', () => {
    const type = Float();
    expect(type.validate(NaN)).toBe('Value must be a number');
  });

  it('Should return an error if value is Infinity', () => {
    const type = Float();
    expect(type.validate(Infinity)).toBe('Value must be a number');
  });

  it('Should return an error if value is -Infinity', () => {
    const type = Float();
    expect(type.validate(-Infinity)).toBe('Value must be a number');
  });

  it('Should return an error if value is less than min', () => {
    const type = Float({ min: 10 });
    expect(type.validate(9)).toBe('Value must be at least 10');
  });

  it('Should return an error if value is greater than max', () => {
    const type = Float({ max: 10 });
    expect(type.validate(11)).toBe('Value must be at most 10');
  });

  it('Should return undefined if value is equal to min', () => {
    const type = Float({ min: 10 });
    expect(type.validate(10)).toBeUndefined();
  });

  it('Should return undefined if value is equal to max', () => {
    const type = Float({ max: 10 });
    expect(type.validate(10)).toBeUndefined();
  });

  it('Should return undefined if value is between min and max', () => {
    const type = Float({ min: 10, max: 20 });
    expect(type.validate(15.7)).toBeUndefined();
  });

  it('Should apply bounds equal to zero', () => {
    expect(Float({ min: 0 }).validate(-1)).toBe('Value must be at least 0');
    expect(Float({ max: 0 }).validate(1)).toBe('Value must be at most 0');
  });

  it('Should apply exclusive bounds', () => {
    const type = Float({ exclusiveMin: 0, exclusiveMax: 10 });
    expect(type.validate(0)).toBe('Value must be greater than 0');
    expect(type.validate(10)).toBe('Value must be less than 10');
    expect(type.validate(5)).toBeUndefined();
  });
});

describe('multipleOfPrecision', () => {
  it('Should accept a division within 1e-precision of an integer, as ajv', () => {
    const schema = { type: 'number', multipleOf: 0.1 };
    expect(compileJsonSchema(schema)(0.3)).toEqual(['Value must be a multiple of 0.1']);
    expect(compileJsonSchema(schema, { multipleOfPrecision: 8 })(0.3)).toEqual([]);
    expect(compileJsonSchema(schema, { multipleOfPrecision: 8, errors: false })(0.35)).toBe(false);
    expect(compileJsonSchema({ type: 'integer', multipleOf: 3 }, { multipleOfPrecision: 8 })(10)).toEqual([
      'Value must be a multiple of 3',
    ]);
  });

  it('Should work in the DSL', () => {
    expect(new Float({ multipleOf: 0.1, multipleOfPrecision: 8 }).validate(0.3)).toBeUndefined();
    expect(new Float({ multipleOf: 0.1, multipleOfPrecision: 8 }).compile()(0.35)).toEqual([
      'Value must be a multiple of 0.1',
    ]);
    expect(Integer({ multipleOf: 2, multipleOfPrecision: 4 }).isValid(4)).toBe(true);
  });

  it('Should throw on an invalid option', () => {
    expect(() => compileJsonSchema({}, { multipleOfPrecision: 0 })).toThrow(
      'Unsupported JSON Schema option "multipleOfPrecision": expected a positive integer'
    );
  });
});
