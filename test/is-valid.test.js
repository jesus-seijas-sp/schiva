const {
  AllOf,
  AnyOf,
  ArrayOf,
  Float,
  Integer,
  Schema,
  String,
  compileJsonSchema,
  fromJsonSchema,
  hasErrors,
} = require('../src');

const { CheckType, samples, types } = require('./fixtures/types');

describe('isValid', () => {
  // Compared with errors(), which never takes the isValid() fast path of the type itself.
  describe('Agrees with errors for every type and sample', () => {
    it.each(Object.entries(types))('%s', (name, create) => {
      const type = create();
      samples.forEach((value) => {
        const expected = !hasErrors(type.errors(value));
        expect({ value, valid: type.isValid(value) }).toEqual({ value, valid: expected });
      });
    });
  });

  it('Should check extra keys of a Schema against additionalType', () => {
    const schema = new Schema({ id: String() }, { additionalType: Integer() });
    expect(schema.isValid({ id: 'x', count: 1 })).toBe(true);
    expect(schema.isValid({ id: 'x', count: 'many' })).toBe(false);
  });

  it('Should follow isMandatory and isNullable changed after construction', () => {
    const type = String();
    expect(type.isValid(undefined)).toBe(false);
    expect(type.isValid(null)).toBe(false);
    type.optional().nullable();
    expect(type.isValid(undefined)).toBe(true);
    expect(type.isValid(null)).toBe(true);
  });

  it('Should fall back to validate in custom subclasses of ValidateType', () => {
    const type = new CheckType((value) => value % 2 === 0, 'must be even');
    expect(type.isValid(2)).toBe(true);
    expect(type.isValid(3)).toBe(false);
    expect(new Schema({ n: type }).validate({ n: 3 })).toEqual(['n must be even']);
  });

  it('Should use the fallback of custom types nested in built-in containers', () => {
    const type = ArrayOf({ type: new CheckType((value) => value.length > 0, 'must not be empty', true) });
    expect(type.isValid(['a', 'b'])).toBe(true);
    expect(type.isValid(['a', ''])).toBe(false);
    expect(type.validate(['a', ''])).toEqual(['Value[1] must not be empty']);
  });

  describe('Unique arrays', () => {
    it('Should treat NaN as equal to NaN', () => {
      const type = ArrayOf({ unique: true });
      expect(type.isValid([NaN, 1])).toBe(true);
      expect(type.isValid([NaN, NaN])).toBe(false);
      expect(type.validate([NaN, NaN])).toBe('Value must not have duplicate elements');
    });

    it('Should treat 0 and -0 as equal', () => {
      expect(ArrayOf({ unique: true }).isValid([0, -0])).toBe(false);
    });

    it('Should compare objects deeply', () => {
      const type = ArrayOf({ unique: true });
      expect(type.isValid([{ a: [1] }, { a: [2] }])).toBe(true);
      expect(type.isValid([{ a: [1] }, { a: [1] }])).toBe(false);
    });

    it('Should tell apart equal-looking values of different types', () => {
      expect(ArrayOf({ unique: true }).isValid([1, '1', true, null, undefined])).toBe(true);
    });

    it('Should only report an element as duplicate when an earlier index matches it', () => {
      const type = ArrayOf({ unique: true });
      // eslint-disable-next-line no-sparse-arrays
      expect(type.isValid([, undefined])).toBe(false);
      // eslint-disable-next-line no-sparse-arrays
      expect(type.isValid([undefined, ,])).toBe(true);
    });
  });
});

describe('errors', () => {
  it('Should default to validate', () => {
    const type = Integer({ min: 1 });
    expect(type.errors(0, 'count')).toBe(type.validate(0, 'count'));
    expect(type.errors('a')).toBe('Value must be a number');
  });

  it('Should give the same messages as validate for an invalid Schema', () => {
    const schema = new Schema({ id: String(), inner: { age: Integer({ min: 18 }) } }, { isOpen: false });
    const value = { id: 1, inner: { age: 10 }, extra: true };
    expect(schema.errors(value)).toEqual(schema.validate(value));
    expect(schema.errors(value)).toEqual([
      'id must be a string',
      'inner.age must be at least 18',
      'Unexpected key: extra',
    ]);
    expect(schema.errors(value, 'order')).toEqual([
      'order.id must be a string',
      'order.inner.age must be at least 18',
      'Unexpected key: order.extra',
    ]);
  });

  it('Should report presence and shape errors of a Schema', () => {
    const schema = new Schema({ id: String() });
    expect(schema.errors(undefined)).toEqual(['Value is mandatory']);
    expect(schema.errors(null, 'item')).toEqual(['item cannot be null']);
    expect(schema.errors([])).toEqual(['Value must be an object']);
  });

  it('Should report additionalType and property count errors of a Schema', () => {
    const schema = new Schema({ id: String() }, { additionalType: Integer(), maxProperties: 2 });
    expect(schema.errors({ id: 'x', a: 'no', b: 2 })).toEqual([
      'a must be a number',
      'Value must have at most 2 properties',
    ]);
  });

  it('Should only report the failing elements of an array with their paths', () => {
    const type = ArrayOf({ type: new Schema({ qty: Integer({ min: 1 }) }) });
    const value = [{ qty: 1 }, { qty: 0 }, { qty: 2 }, { qty: 'x' }];
    expect(type.validate(value, 'lines')).toEqual(['lines[1].qty must be at least 1', 'lines[3].qty must be a number']);
  });

  it('Should report the errors of every failing AnyOf alternative', () => {
    const type = AnyOf({ types: [String({ min: 5 }), Integer()] });
    expect(type.validate('abc')).toEqual(['Value must be at least 5 characters long', 'Value must be a number']);
  });

  it('Should report the errors of the first failing AllOf type', () => {
    const type = AllOf({ types: [Float({ min: 0 }), Integer({ max: 10 })] });
    expect(type.validate(20)).toBe('Value must be at most 10');
  });
});

describe('Error collection is skipped for valid values', () => {
  function spyOnChild(type) {
    return { validate: jest.spyOn(type, 'validate'), errors: jest.spyOn(type, 'errors') };
  }

  it('Should not collect errors of valid Schema keys', () => {
    const id = String();
    const age = Integer({ min: 18 });
    const idSpy = spyOnChild(id);
    const ageSpy = spyOnChild(age);
    const schema = new Schema({ id, age });
    expect(schema.validate({ id: 'x', age: 10 })).toEqual(['age must be at least 18']);
    expect(idSpy.validate).not.toHaveBeenCalled();
    expect(idSpy.errors).not.toHaveBeenCalled();
    expect(ageSpy.errors).toHaveBeenCalledTimes(1);
  });

  it('Should not collect errors of valid array elements', () => {
    const item = Integer();
    const spy = spyOnChild(item);
    const type = ArrayOf({ type: item });
    expect(type.validate([1, 2, 'x', 4])).toEqual(['Value[2] must be a number']);
    expect(spy.errors).toHaveBeenCalledTimes(1);
    expect(spy.errors).toHaveBeenCalledWith('x', 'Value[2]');
  });

  it('Should not collect errors of a valid Schema', () => {
    const id = String();
    const spy = spyOnChild(id);
    const schema = new Schema({ id });
    const errorsSpy = jest.spyOn(schema, 'errors');
    expect(schema.validate({ id: 'x' })).toEqual([]);
    expect(errorsSpy).not.toHaveBeenCalled();
    expect(spy.validate).not.toHaveBeenCalled();
    expect(spy.errors).not.toHaveBeenCalled();
    expect(schema.validate({ id: 1 })).toEqual(['id must be a string']);
    expect(errorsSpy).toHaveBeenCalledTimes(1);
  });

  it('Should not use the interpreted errors in compileJsonSchema, which generates its messages', () => {
    const errorsSpy = jest.spyOn(Schema.prototype, 'errors');
    try {
      const validate = compileJsonSchema({ type: 'object', properties: { id: { type: 'string' } } });
      expect(validate({ id: 'x' })).toEqual([]);
      expect(validate({ id: 1 })).toEqual(['id must be a string']);
      expect(errorsSpy).not.toHaveBeenCalled();
    } finally {
      errorsSpy.mockRestore();
    }
  });

  it('Should give isValid for types built from a JSON Schema', () => {
    const type = fromJsonSchema({ type: 'array', items: { type: ['integer', 'null'], minimum: 1 } });
    expect(type.isValid([1, null, 3])).toBe(true);
    expect(type.isValid([1, 0])).toBe(false);
  });
});

describe('hasErrors', () => {
  it('Should be false for undefined and nested empty arrays', () => {
    expect(hasErrors(undefined)).toBe(false);
    expect(hasErrors([])).toBe(false);
    expect(hasErrors([[], [[]]])).toBe(false);
  });

  it('Should be true for a message at any depth', () => {
    expect(hasErrors('error')).toBe(true);
    expect(hasErrors([[], ['error']])).toBe(true);
    expect(hasErrors([[[['error']]]])).toBe(true);
  });

  it('Should count any non-array element inside an array as an error', () => {
    expect(hasErrors('')).toBe(false);
    expect(hasErrors([''])).toBe(true);
  });
});
