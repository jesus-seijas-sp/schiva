const { AnyOf, Schema, String, Integer } = require('../src');

describe('AnyOf', () => {
  it('Should return an error if value is undefined and is mandatory', () => {
    const schema = AnyOf({
      types: [String({ min: 10, max: 50 }), Integer({ min: 18, max: 99 })],
    });
    expect(schema.validate(undefined)).toEqual('Value is mandatory');
  });

  it('Should return undefined if value is undefined and is not mandatory', () => {
    const schema = AnyOf({
      types: [String({ min: 10, max: 50 }), Integer({ min: 18, max: 99 })],
      isMandatory: false,
    });
    expect(schema.validate(undefined)).toEqual(undefined);
  });

  it('Should return an error if value is null and is not nullable', () => {
    const schema = AnyOf({
      types: [String({ min: 10, max: 50 }), Integer({ min: 18, max: 99 })],
    });
    expect(schema.validate(null)).toEqual('Value cannot be null');
  });

  it('Should return undefined if value is null and is nullable', () => {
    const schema = AnyOf({
      types: [String({ min: 10, max: 50 }), Integer({ min: 18, max: 99 })],
      isNullable: true,
    });
    expect(schema.validate(null)).toEqual(undefined);
  });

  it('Should return undefined if value match one of the types', () => {
    const schema = AnyOf({
      types: [String({ min: 10, max: 50 }), Integer({ min: 18, max: 99 })],
    });
    expect(schema.validate(25)).toEqual(undefined);
    expect(schema.validate('This is a long string')).toEqual(undefined);
  });

  it('Should return array of errors from the types', () => {
    const schema = AnyOf({
      types: [String({ min: 10, max: 50 }), Integer({ min: 18, max: 99 })],
    });
    expect(schema.validate(true)).toEqual(['Value must be a string', 'Value must be a number']);
  });

  it('Should treat an empty error list from a Schema as a match', () => {
    const schema = AnyOf({ types: [new Schema({ name: String() }), Integer()] });
    expect(schema.validate({ name: 'a' })).toEqual(undefined);
  });
});
