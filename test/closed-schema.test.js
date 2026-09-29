const { ClosedSchema, String, Integer } = require('../src');

const personDefinition = {
  id: String(),
  name: String({ min: 10, max: 50 }),
  age: Integer({ min: 18, max: 99 }),
};

describe('Closed Schema', () => {
  it('Should return an error if there are unexpected keys', () => {
    const schema = new ClosedSchema(personDefinition);
    const person = {
      id: '1234567890',
      name: 'A long name',
      age: 25,
      type: 'normal',
    };
    const errors = schema.validate(person);
    expect(errors).toEqual(['Unexpected key: type']);
  });

  it('Should return an error if a key is missing', () => {
    const schema = new ClosedSchema(personDefinition);
    const person = {
      id: '1234567890',
      age: 25,
    };
    const errors = schema.validate(person);
    expect(errors).toEqual(['name is mandatory']);
  });

  it('Should return a list of all errors', () => {
    const schema = new ClosedSchema(personDefinition, { isOpen: false });
    const person = {
      id: '1234567890',
      age: 17,
      type: 'normal',
    };
    const errors = schema.validate(person);
    expect(errors).toEqual(['name is mandatory', 'age must be at least 18', 'Unexpected key: type']);
  });
});
