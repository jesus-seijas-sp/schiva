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

  it('Should return the errors of the type that fails', () => {
    const type = AllOf({ types: [Integer(), Float({ min: 5 })] });
    expect(type.validate(4)).toEqual('Value must be at least 5');
    expect(type.validate(5.5)).toEqual('Value must be an integer');
  });

  it('Should treat an empty error list from a Schema as valid', () => {
    const type = AllOf({ types: [new Schema({ a: Integer() })] });
    expect(type.validate({ a: 1 })).toBeUndefined();
    expect(type.validate({ a: 'x' }, 'obj')).toEqual(['obj.a must be a number']);
  });

  it('Should return the errors of every type that fails, naming keys as a Schema on its own does', () => {
    const type = AllOf({ types: [new Schema({ a: Integer() }), new Schema({ b: Integer() })] });
    expect(type.validate({ a: 'x', b: 'y' })).toEqual(['a must be a number', 'b must be a number']);
    expect(type.validate({ a: 'x', b: 'y' }, 'obj')).toEqual(['obj.a must be a number', 'obj.b must be a number']);
  });
});
