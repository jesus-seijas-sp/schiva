const closedSchema = require('./closed-schema');
const compile = require('./compile');
const jsonSchema = require('./json-schema');
const schema = require('./schema');
const types = require('./types');

module.exports = {
  ...closedSchema,
  ...compile,
  ...jsonSchema,
  ...schema,
  ...types,
};
