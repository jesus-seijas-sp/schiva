const { Boolean } = require('../src');

describe('Boolean Type', () => {
  it('Should allow undefined if not mandatory', () => {
    const type = Boolean({ isMandatory: false });
    expect(type.validate(undefined)).toBeUndefined();
  });

  it('Should return an error if mandatory and value is undefined', () => {
    const type = Boolean();
    expect(type.validate(undefined)).toBe('Value is mandatory');
  });

  it('Should return an error if value is not boolean', () => {
    const type = Boolean();
    expect(type.validate('')).toBe('Value must be a boolean');
  });

  it('Should return undefined if value is boolean', () => {
    const type = Boolean();
    expect(type.validate(true)).toBeUndefined();
    expect(type.validate(false)).toBeUndefined();
  });
});
