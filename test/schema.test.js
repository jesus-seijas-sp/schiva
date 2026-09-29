const { Schema, String, Integer } = require('../src');

const personDefinition = {
  id: String(),
  name: String({ min: 10, max: 50 }),
  age: Integer({ min: 18, max: 99 }),
};

describe('Schema', () => {
  it('Should return an error if schema is not open and there are unexpected keys', () => {
    const schema = new Schema(personDefinition, { isOpen: false });
    const person = {
      id: '1234567890',
      name: 'A long name',
      age: 25,
      type: 'normal',
    };
    const errors = schema.validate(person);
    expect(errors).toEqual(['Unexpected key: type']);
  });

  it('Should allow extra keys if schema is open', () => {
    const schema = new Schema(personDefinition);
    const person = {
      id: '1234567890',
      name: 'A long name',
      age: 25,
      type: 'normal',
    };
    const errors = schema.validate(person);
    expect(errors).toEqual([]);
  });

  it('Should return an error if a key is missing', () => {
    const schema = new Schema(personDefinition);
    const person = {
      id: '1234567890',
      age: 25,
    };
    const errors = schema.validate(person);
    expect(errors).toEqual(['name is mandatory']);
  });

  it('Should return a list of all errors', () => {
    const schema = new Schema(personDefinition, { isOpen: false });
    const person = {
      id: '1234567890',
      age: 17,
      type: 'normal',
    };
    const errors = schema.validate(person);
    expect(errors).toEqual(['name is mandatory', 'age must be at least 18', 'Unexpected key: type']);
  });

  it('Should return an error if value is not an object', () => {
    const schema = new Schema(personDefinition);
    expect(schema.validate('x')).toEqual(['Value must be an object']);
    expect(schema.validate([], 'person')).toEqual(['person must be an object']);
  });

  it('Should validate extra keys with additionalType', () => {
    const schema = new Schema({}, { additionalType: Integer() });
    expect(schema.validate({ a: 1, b: 'x' })).toEqual(['b must be a number']);
  });

  it('Should validate the number of properties', () => {
    const schema = new Schema({}, { minProperties: 1, maxProperties: 2 });
    expect(schema.validate({})).toEqual(['Value must have at least 1 properties']);
    expect(schema.validate({ a: 1, b: 2, c: 3 })).toEqual(['Value must have at most 2 properties']);
  });
});
