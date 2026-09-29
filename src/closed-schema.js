const { Schema } = require('./schema');

class ClosedSchema extends Schema {
  constructor(schema = {}, options = {}) {
    super(schema, { ...options, isOpen: false });
  }
}

module.exports = {
  ClosedSchema,
};
