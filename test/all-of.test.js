const { AllOf, Integer, Float, Schema } = require('../src');

describe('AllOf', () => {
  it('Should return an error if value is undefined and is mandatory', () => {
    const type = AllOf({ types: [Integer()] });
    expect(type.validate(undefined)).toEqual('Value is mandatory');
  });

  it('Should return undefined if value is null and is nullable', () => {
    const type = AllOf({ types: [Integer()], isNullable: true });
    expect(type.validate(null)).toBeUndefined();
  });

  it('Should return undefined if value matches every type', () => {
    const type = AllOf({ types: [Integer(), Float({ min: 5 })] });
    expect(type.validate(6)).toBeUndefined();
  });

  it('Should return the errors of the first failing type', () => {
    const type = AllOf({ types: [Integer(), Float({ min: 5 })] });
    expect(type.validate(4)).toEqual('Value must be at least 5');
    expect(type.validate(5.5)).toEqual('Value must be an integer');
  });

  it('Should treat an empty error list from a Schema as valid', () => {
    const type = AllOf({ types: [new Schema({ a: Integer() })] });
    expect(type.validate({ a: 1 })).toBeUndefined();
    expect(type.validate({ a: 'x' }, 'obj')).toEqual(['obj.a must be a number']);
  });
});
