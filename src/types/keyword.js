const { ValidateType } = require('./validate-type');

// Tests of the JSON types a keyword of your own can be limited to. null never reaches them: whether a node accepts null
// is worked out when converting (see acceptsNull() in json-schema.js).
const KEYWORD_TYPE_TESTS = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number',
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  object: (value) => typeof value === 'object' && !Array.isArray(value),
  array: (value) => Array.isArray(value),
  null: (value) => value === null,
};

// A keyword of your own (the option "keywords" of compileJsonSchema()): `check`, a function or a regular expression,
// tells whether the value passes it, and `message` gives the text after the name of the value, or `message(value)`
// does. With `jsonTypes`, it only checks values of those JSON types, as the keywords of JSON Schema do.
class KeywordType extends ValidateType {
  constructor(options = {}) {
    super(options);
    if (typeof options.check !== 'function' && !(options.check instanceof RegExp)) {
      throw new Error('KeywordType check must be a function or a regular expression');
    }
    this.keyword = options.keyword;
    this.check = options.check;
    this.message = options.message;
    this.jsonTypes = options.jsonTypes;
  }

  // Whether the keyword checks the value (neither undefined nor null).
  applies(value) {
    return !this.jsonTypes || this.jsonTypes.some((jsonType) => KEYWORD_TYPE_TESTS[jsonType](value));
  }

  passes(value) {
    return this.check instanceof RegExp ? this.check.test(value) : Boolean(this.check(value));
  }

  messageOf(value) {
    return typeof this.message === 'function' ? this.message(value) : this.message;
  }

  validate(value, fieldName = undefined) {
    const name = fieldName || 'Value';
    const result = super.validate(value, name);
    if (result) {
      return result;
    }
    if (value !== undefined && value !== null && this.applies(value) && !this.passes(value)) {
      return `${name} ${this.messageOf(value)}`;
    }
    return undefined;
  }

  isValid(value) {
    return this.checkPresence(value) ?? (!this.applies(value) || this.passes(value));
  }
}

module.exports = {
  KeywordType,
  KEYWORD_TYPE_TESTS,
};
