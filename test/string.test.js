const { String } = require('../src');

describe('String Type', () => {
  it('Should allow undefined if not mandatory', () => {
    const type = String({ isMandatory: false });
    expect(type.validate(undefined)).toBeUndefined();
  });

  it('Should return an error if mandatory and value is undefined', () => {
    const type = String();
    expect(type.validate(undefined)).toBe('Value is mandatory');
  });

  it('Should return an error if value is not string', () => {
    const type = String();
    expect(type.validate(7)).toBe('Value must be a string');
  });

  it('Should return undefined if value is valid string', () => {
    const type = String();
    expect(type.validate('hello')).toBeUndefined();
  });

  it('Should return an error if value is too short', () => {
    const type = String({ min: 5 });
    expect(type.validate('hi')).toBe('Value must be at least 5 characters long');
  });

  it('Should return an error if value is too long', () => {
    const type = String({ max: 5 });
    expect(type.validate('hello world')).toBe('Value must be at most 5 characters long');
  });

  it('Should return undefined if value is within range', () => {
    const type = String({ min: 5, max: 10 });
    expect(type.validate('hello')).toBeUndefined();
  });

  it('Should return an error if value does not match pattern', () => {
    const type = String({ pattern: /^[A-Z]+$/ });
    expect(type.validate('hello')).toBe('Value does not match the required pattern');
  });

  it('Should return undefined if value matches pattern', () => {
    const type = String({ pattern: /^[A-Z]+$/ });
    expect(type.validate('HELLO')).toBeUndefined();
  });

  it('Should return custom pattern message if provided', () => {
    const type = String({
      pattern: /^[A-Z]+$/,
    });
    expect(type.validate('hello')).toBe('Value does not match the required pattern');
  });

  it('Should allow empty optional strings below min by default', () => {
    expect(String({ min: 2, isMandatory: false }).validate('')).toBeUndefined();
  });

  it('Should reject empty strings below min when allowEmpty is false', () => {
    expect(String({ min: 2, isMandatory: false, allowEmpty: false }).validate('')).toBe(
      'Value must be at least 2 characters long'
    );
  });
});
