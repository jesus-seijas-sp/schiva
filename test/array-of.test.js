const { ArrayOf, Schema, String, Integer } = require('../src');

const personDefinition = {
  id: String(),
  name: String({ min: 10, max: 50 }),
  age: Integer({ min: 18, max: 99 }),
};

describe('ArrayOf', () => {
  it('Should allow undefined if not mandatory', () => {
    const type = ArrayOf({ isMandatory: false });
    expect(type.validate(undefined)).toBeUndefined();
  });

  it('Should return an error if mandatory and value is undefined', () => {
    const type = ArrayOf();
    expect(type.validate(undefined)).toBe('Value is mandatory');
  });

  it('Should return an error if value is not an array', () => {
    const arrayOf = new ArrayOf();
    const error = arrayOf.validate('123');
    expect(error).toEqual('Value must be an array');
  });

  it('Should return an error if value has less elements than min', () => {
    const arrayOf = new ArrayOf({ min: 2 });
    const error = arrayOf.validate(['123']);
    expect(error).toEqual('Value must have at least 2 elements');
  });

  it('Should return an error if value has more elements than max', () => {
    const arrayOf = new ArrayOf({ max: 2 });
    const error = arrayOf.validate(['123', '123', '123']);
    expect(error).toEqual('Value must have at most 2 elements');
  });

  it('Should return an error if value has an element that does not match the type', () => {
    const arrayOf = new ArrayOf({ type: String() });
    const error = arrayOf.validate(['123', 123]);
    expect(error).toEqual(['Value[1] must be a string']);
  });

  it('Should return a list of errors if value has an element that does not match the type', () => {
    const personSchema = new Schema(personDefinition, { isOpen: false });
    const arrayOf = new ArrayOf({ type: personSchema });
    const input = [
      {
        id: '1234567890',
        name: 'A long name',
        age: 25,
      },
      {
        id: '1234567890',
        name: 'A long name',
        age: 25,
        type: 'normal',
      },
      {
        id: '1234567890',
        name: 'short',
        age: 25,
      },
    ];
    const actual = arrayOf.validate(input);
    const expected = ['Unexpected key: Value[1].type', 'Value[2].name must be at least 10 characters long'];
    expect(actual).toEqual(expected);
  });

  it('Should return empty array if value is valid', () => {
    const personSchema = new Schema(personDefinition, { isOpen: true });
    const arrayOf = new ArrayOf({ type: personSchema });
    const input = [
      {
        id: '1234567890',
        name: 'A long name',
        age: 25,
      },
      {
        id: '1234567890',
        name: 'A long name',
        age: 25,
        type: 'normal',
      },
      {
        id: '1234567890',
        name: 'A long name',
        age: 25,
      },
    ];
    const actual = arrayOf.validate(input);
    expect(actual).toEqual([]);
  });

  it('Should return an error if some element does not match the type and the type is an array', () => {
    const arrayOf = new ArrayOf({ type: [String(), Integer(), Integer()] });
    const error = arrayOf.validate(['123', 123, '123']);
    expect(error).toEqual(['Value[2] must be a number']);
  });

  it('Should return empty array if all elements match their types', () => {
    const arrayOf = new ArrayOf({ type: [String(), Integer(), Integer()] });
    const error = arrayOf.validate(['123', 123, 123]);
    expect(error).toEqual([]);
  });

  it('Should return undefined if no type is defined', () => {
    const arrayOf = new ArrayOf();
    const error = arrayOf.validate(['123', 123, 123]);
    expect(error).toEqual(undefined);
  });

  it('Should return an error if unique and there are duplicated elements', () => {
    const arrayOf = new ArrayOf({ unique: true });
    expect(arrayOf.validate([{ a: 1 }, { a: 1 }])).toEqual('Value must not have duplicate elements');
    expect(arrayOf.validate([{ a: 1 }, { a: 2 }])).toBeUndefined();
  });
});
