const { compileJsonSchema, standaloneJsonSchema, fromJsonSchema } = require('../src');

// Every mode, the interpreter and standalone code give the same verdict; returns the errors.
function check(schema, value, options = { formats: true }) {
  const errors = compileJsonSchema(schema, options)(value);
  expect(compileJsonSchema(schema, { ...options, allErrors: false })(value)).toEqual(errors.slice(0, 1));
  expect(compileJsonSchema(schema, { ...options, errors: false })(value)).toBe(errors.length === 0);
  expect(fromJsonSchema(schema, options).isValid(value)).toBe(errors.length === 0);
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func -- loads the generated module
  new Function('module', 'exports', standaloneJsonSchema(schema, options))(module, module.exports);
  expect(module.exports(value)).toEqual(errors);
  return errors;
}

describe('formatMinimum, formatMaximum, formatExclusiveMinimum and formatExclusiveMaximum', () => {
  const dates = { type: 'string', format: 'date', formatMinimum: '2020-01-01', formatExclusiveMaximum: '2021-01-01' };

  it('Should limit dates', () => {
    expect(check(dates, '2020-01-01')).toEqual([]);
    expect(check(dates, '2019-12-31')).toEqual(['Value must be at least 2020-01-01']);
    expect(check(dates, '2021-01-01')).toEqual(['Value must be less than 2021-01-01']);
    expect(check({ ...dates, formatMinimum: undefined, formatExclusiveMinimum: '2020-01-01' }, '2020-01-01')).toEqual([
      'Value must be greater than 2020-01-01',
    ]);
  });

  it('Should limit times and date-times by the moment they name', () => {
    const times = { type: 'string', format: 'time', formatMaximum: '12:00:00Z' };
    expect(check(times, '13:30:00+02:00')).toEqual([]);
    expect(check(times, '12:30:00Z')).toEqual(['Value must be at most 12:00:00Z']);
    const moments = { type: 'string', format: 'date-time', formatMinimum: '2020-01-01T00:00:00Z' };
    expect(check(moments, '2020-01-01T01:00:00+01:00')).toEqual([]);
    expect(check(moments, '2019-12-31T23:00:00-01:30')).toEqual([]);
    expect(check(moments, '2019-12-31T23:59:59Z')).toEqual(['Value must be at least 2020-01-01T00:00:00Z']);
  });

  it('Should report the format, and not the limits, of a value without it', () => {
    expect(check(dates, '2019-13-01')).toEqual(['Value must be a valid date']);
  });

  it('Should give error objects with the params of ajv', () => {
    const validate = compileJsonSchema(dates, { formats: true, errors: 'objects' });
    expect(validate('2019-01-01')).toEqual([
      {
        path: [],
        pointer: '',
        keyword: 'formatMinimum',
        params: { comparison: '>=', limit: '2020-01-01' },
        message: 'Value must be at least 2020-01-01',
      },
    ]);
  });

  it('Should be ignored when the format is not checked, as it is', () => {
    expect(check(dates, '2019-01-01', {})).toEqual([]);
    expect(check(dates, '2019-01-01', { formats: { email: true, date: false } })).toEqual([]);
    expect(check(dates, '2019-01-01', { formats: ['email'], strict: false })).toEqual([]);
  });

  it('Should apply to strings in schemas without type', () => {
    const untyped = { format: 'date', formatMaximum: '2020-01-01' };
    expect(check(untyped, '2021-01-01')).toEqual(['Value must be at most 2020-01-01']);
    expect(check(untyped, 5)).toEqual([]);
  });

  it('Should compare the values of formats of your own with their compare function', () => {
    const version = {
      validate: /^\d+\.\d+$/,
      compare: (a, b) => {
        const [a1, a2] = a.split('.').map(Number);
        const [b1, b2] = b.split('.').map(Number);
        return a1 - b1 || a2 - b2;
      },
    };
    const schema = { type: 'string', format: 'version', formatMinimum: '1.10' };
    const options = { formats: { version } };
    expect(compileJsonSchema(schema, options)('1.9')).toEqual(['Value must be at least 1.10']);
    expect(compileJsonSchema(schema, options)('2.0')).toEqual([]);
    expect(compileJsonSchema(schema, options)('x')).toEqual(['Value must be a valid version']);
  });

  it('Should throw without format, with a format that cannot be compared, or with an invalid limit', () => {
    const at = 'Unsupported JSON Schema at #:';
    expect(() => compileJsonSchema({ type: 'string', formatMinimum: '2020-01-01' }, { formats: true })).toThrow(
      `${at} "formatMinimum" requires "format"`
    );
    expect(() =>
      compileJsonSchema({ type: 'string', format: 'email', formatMinimum: 'a@b.c' }, { formats: true })
    ).toThrow(`${at} "formatMinimum": the values of the format "email" cannot be compared`);
    expect(() => compileJsonSchema({ ...dates, formatMinimum: '2020-13-01' }, { formats: true })).toThrow(
      `${at} "formatMinimum" must be a valid date`
    );
    expect(() =>
      compileJsonSchema({ type: 'number', format: 'date', formatMinimum: '2020-01-01' }, { formats: true })
    ).toThrow('JSON Schema keyword "formatMinimum" at # requires "type": "string"');
    expect(() => compileJsonSchema({}, { formats: { v: { validate: /x/, compare: 1 } } })).toThrow(
      'Unsupported JSON Schema option "formats": the "compare" of "v" must be a function'
    );
  });

  it('Should never fail a limit at time 0, as ajv-formats compares it', () => {
    const epoch = { type: 'string', format: 'date-time', formatMaximum: '1970-01-01T00:00:00Z' };
    expect(check(epoch, '2020-01-01T00:00:00Z')).toEqual([]);
  });
});
