const { Integer } = require('../src');

describe('Integer Type', () => {
  it('Should allow undefined if not mandatory', () => {
    const type = Integer({ isMandatory: false });
    expect(type.validate(undefined)).toBeUndefined();
  });

  it('Should return an error if mandatory and value is undefined', () => {
    const type = Integer();
    expect(type.validate(undefined)).toBe('Value is mandatory');
  });

  it('Should return an error if value is not a number', () => {
    const type = Integer();
    expect(type.validate('')).toBe('Value must be a number');
  });

  it('Should return an error if value is NaN', () => {
    const type = Integer();
    expect(type.validate(NaN)).toBe('Value must be a number');
  });

  it('Should return an error if value is Infinity', () => {
    const type = Integer();
    expect(type.validate(Infinity)).toBe('Value must be a number');
  });

  it('Should return an error if value is -Infinity', () => {
    const type = Integer();
    expect(type.validate(-Infinity)).toBe('Value must be a number');
  });

  it('Should return an error if value is less than min', () => {
    const type = Integer({ min: 10 });
    expect(type.validate(9)).toBe('Value must be at least 10');
  });

  it('Should return an error if value is greater than max', () => {
    const type = Integer({ max: 10 });
    expect(type.validate(11)).toBe('Value must be at most 10');
  });

  it('Should return an error if value is not an integer', () => {
    const type = Integer();
    expect(type.validate(10.5)).toBe('Value must be an integer');
  });

  it('Should return undefined if value is equal to min', () => {
    const type = Integer({ min: 10 });
    expect(type.validate(10)).toBeUndefined();
  });

  it('Should return undefined if value is equal to max', () => {
    const type = Integer({ max: 10 });
    expect(type.validate(10)).toBeUndefined();
  });

  it('Should return undefined if value is between min and max', () => {
    const type = Integer({ min: 10, max: 20 });
    expect(type.validate(15)).toBeUndefined();
  });
});
