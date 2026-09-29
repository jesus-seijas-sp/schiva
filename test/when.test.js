const { When, Integer, Schema, String, Values, compileType, isJsonType } = require('../src');

describe('When', () => {
  it('Should only check values of its JSON type', () => {
    const type = When({ jsonType: 'string', type: String({ min: 3 }) });
    expect(type.validate('ab')).toBe('Value must be at least 3 characters long');
    expect(type.validate('abc')).toBeUndefined();
    expect(type.validate(1)).toBeUndefined();
    expect(type.isValid('ab')).toBe(false);
    expect(type.isValid(1)).toBe(true);
  });

  it('Should check presence itself', () => {
    expect(When({ jsonType: 'number', type: Integer() }).validate(undefined)).toBe('Value is mandatory');
    expect(When({ jsonType: 'number', type: Integer() }).validate(null)).toBe('Value cannot be null');
    expect(When({ jsonType: 'number', type: Integer(), isMandatory: false }).validate(undefined)).toBeUndefined();
  });

  it('Should not add its own name to messages', () => {
    const type = When({ jsonType: 'object', type: new Schema({ age: Integer() }) });
    expect(type.validate({ age: 'x' })).toEqual(['age must be a number']);
    expect(type.errors({ age: 'x' }, 'person')).toEqual(['person.age must be a number']);
  });

  it('Should throw on unknown JSON types', () => {
    expect(() => When({ jsonType: 'integer', type: Integer() })).toThrow('jsonType must be one of');
  });

  it('Should tell JSON types apart', () => {
    expect(isJsonType({}, 'object')).toBe(true);
    expect(isJsonType([], 'object')).toBe(false);
    expect(isJsonType(null, 'object')).toBe(false);
    expect(isJsonType([], 'array')).toBe(true);
    expect(isJsonType('1', 'number')).toBe(false);
    expect(isJsonType(1.5, 'number')).toBe(true);
    expect(isJsonType('', 'string')).toBe(true);
  });
});

describe('String length in code points', () => {
  it('Should count a surrogate pair as one character with countCodePoints', () => {
    const type = String({ min: 2, max: 2, countCodePoints: true });
    expect(type.validate('\u{1F4A9}')).toBe('Value must be at least 2 characters long');
    expect(type.validate('\u{1F4A9}\u{1F4A9}')).toBeUndefined();
    expect(compileType(type)('\u{1F4A9}\u{1F4A9}')).toEqual([]);
    expect(compileType(type)('\u{1F4A9}')).toEqual(['Value must be at least 2 characters long']);
  });

  it('Should count UTF-16 units by default', () => {
    expect(String({ max: 1 }).validate('\u{1F4A9}')).toBe('Value must be at most 1 characters long');
  });

  it('Should count a lone surrogate as one character', () => {
    expect(String({ max: 2, countCodePoints: true }).validate('a\uD83D')).toBeUndefined();
  });
});

describe('Schema keys named like Object.prototype properties', () => {
  const schema = () => new Schema({ constructor: String(), toString: Integer({ isMandatory: false }) });

  it('Should not take inherited properties as present', () => {
    expect(schema().validate({})).toEqual(['constructor is mandatory']);
    expect(compileType(schema())({})).toEqual(['constructor is mandatory']);
    expect(schema().validate({ constructor: 'x' })).toEqual([]);
    expect(compileType(schema())({ constructor: 'x', toString: 'y' })).toEqual(['toString must be a number']);
  });

  it('Should read own values of objects whose prototype cannot be read with __proto__', () => {
    const idSchema = () => new Schema({ id: String(), toString: Integer({ isMandatory: false }) });
    const withProtoKey = JSON.parse('{"__proto__": 1, "id": "x", "toString": 2}');
    const noPrototype = Object.assign(Object.create(null), { id: 'x', toString: 'y' });
    [withProtoKey, noPrototype].forEach((value) => {
      expect(idSchema().validate(value)).toEqual(compileType(idSchema())(value));
    });
    expect(compileType(idSchema())(withProtoKey)).toEqual([]);
    expect(compileType(idSchema())(noPrototype)).toEqual(['toString must be a number']);
    expect(compileType(idSchema())(Object.create(null))).toEqual(['id is mandatory']);
  });

  it('Should ignore keys added to Object.prototype after compiling', () => {
    const polluted = new Schema({ isAdmin: Values({ values: [true] }) });
    const validate = compileType(polluted);
    // eslint-disable-next-line no-extend-native
    Object.prototype.isAdmin = true;
    try {
      expect(polluted.validate({})).toEqual(['isAdmin is mandatory']);
      expect(validate({})).toEqual(['isAdmin is mandatory']);
      expect(validate({ isAdmin: true })).toEqual([]);
    } finally {
      delete Object.prototype.isAdmin;
    }
  });

  it('Should ignore properties inherited from other prototypes', () => {
    const value = Object.create({ constructor: 'x' });
    expect(schema().validate(value)).toEqual(['constructor is mandatory']);
    expect(compileType(schema())(value)).toEqual(['constructor is mandatory']);
  });
});

describe('Code point limits', () => {
  it('Should agree with counting code points for every length around the limits', () => {
    const chars = ['a', '\u{1F4A9}', '\uD83D'];
    const values = [''];
    for (let size = 1; size <= 5; size += 1) {
      values.slice().forEach((value) => {
        if (value.length === size - 1 || [...value].length === size - 1) {
          chars.forEach((char) => values.push(value + char));
        }
      });
    }
    [1, 2, 3].forEach((limit) => {
      const type = String({ min: limit, max: limit, countCodePoints: true });
      const validate = compileType(type);
      values.forEach((value) => {
        const { length } = [...value];
        let expected = [];
        if (length < limit) {
          expected = [`Value must be at least ${limit} characters long`];
        } else if (length > limit) {
          expected = [`Value must be at most ${limit} characters long`];
        }
        expect({ value, errors: validate(value) }).toEqual({ value, errors: expected });
        expect({ value, valid: type.isValid(value) }).toEqual({ value, valid: expected.length === 0 });
      });
    });
  });
});
