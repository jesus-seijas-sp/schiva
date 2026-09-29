const { Any } = require('../src');

describe('Any Type', () => {
  it('Should allow undefined if not mandatory', () => {
    const type = Any({ isMandatory: false });
    expect(type.validate(undefined)).toBeUndefined();
  });

  it('Should return an error if mandatory and value is undefined', () => {
    const type = Any();
    expect(type.validate(undefined)).toBe('Value is mandatory');
  });

  it('Should allow null if nullable', () => {
    const type = Any({ isNullable: true });
    expect(type.validate(null)).toBeUndefined();
  });

  it('Should return an error if not nullable and value is null', () => {
    const type = Any();
    expect(type.validate(null)).toBe('Value cannot be null');
  });
});
