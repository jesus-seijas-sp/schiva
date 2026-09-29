const { Values, Const } = require('../src');

describe('Values', () => {
  it('Should return an error if value is undefined and is mandatory', () => {
    expect(Values({ values: [1] }).validate(undefined)).toEqual('Value is mandatory');
  });

  it('Should accept any of the values, whatever their type', () => {
    const type = Values({ values: [1, -1, 'a'] });
    expect(type.validate(1)).toBeUndefined();
    expect(type.validate('a')).toBeUndefined();
    expect(type.validate(2)).toEqual('Value must be one of: 1, -1, a');
  });

  it('Should compare objects by deep equality', () => {
    const type = Values({ values: [{ a: [1] }] });
    expect(type.validate({ a: [1] })).toBeUndefined();
    expect(type.validate({ a: [2] })).toEqual('Value must be equal to {"a":[1]}');
  });

  it('Should build a single value type with Const', () => {
    const type = Const('executor');
    expect(type.validate('executor')).toBeUndefined();
    expect(type.validate('trigger', 'type')).toEqual('type must be equal to executor');
  });
});
