const { Float } = require('../src');

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
