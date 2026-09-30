const allOf = require('./all-of');
const any = require('./any');
const anyOf = require('./any-of');
const arrayOf = require('./array-of');
const boolean = require('./boolean');
const conditional = require('./conditional');
const enums = require('./enum');
const float = require('./float');
const integer = require('./integer');
const keyword = require('./keyword');
const never = require('./never');
const not = require('./not');
const obj = require('./obj');
const oneOf = require('./one-of');
const ref = require('./ref');
const string = require('./string');
const validateType = require('./validate-type');
const values = require('./values');
const when = require('./when');

module.exports = {
  ...allOf,
  ...any,
  ...anyOf,
  ...arrayOf,
  ...boolean,
  ...conditional,
  ...enums,
  ...float,
  ...integer,
  ...keyword,
  ...never,
  ...not,
  ...obj,
  ...oneOf,
  ...ref,
  ...string,
  ...validateType,
  ...values,
  ...when,
};
