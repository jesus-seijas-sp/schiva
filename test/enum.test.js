const { Enum } = require('../src');

describe('Enum Type', () => {
  it('Should allow undefined if not mandatory', () => {
    const type = Enum({ isMandatory: false, options: ['a', 'b', 'c'] });
    expect(type.validate(undefined)).toBeUndefined();
  });

  it('Should return an error if mandatory and value is undefined', () => {
    const type = Enum();
    expect(type.validate(undefined)).toBe('Value is mandatory');
  });

  it('Should return an error if value is not string', () => {
    const type = Enum();
    expect(type.validate(7)).toBe('Value must be a string');
  });

  it('Should return an error if value is not in options', () => {
    const type = Enum({ options: ['a', 'b', 'c'] });
    expect(type.validate('d')).toBe('Value must be one of: a, b, c');
  });

  it('Should return undefined if value is in options', () => {
    const type = Enum({ options: ['a', 'b', 'c'] });
    expect(type.validate('a')).toBeUndefined();
  });
});
