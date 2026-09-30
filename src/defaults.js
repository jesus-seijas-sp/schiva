// The option useDefaults: values of "default" assigned to missing properties and tuple elements before they are
// checked, as ajv does. Each validation assigns a new copy, so the data never shares objects with the schema.

// A copy of a default value: arrays and plain objects are copied deeply; other values are used as they are.
function copyDefault(value) {
  if (Array.isArray(value)) {
    return value.map(copyDefault);
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const copy = {};
    Object.keys(value).forEach((key) => {
      // An own "__proto__" key, as JSON.parse() makes it, stays a plain entry.
      Object.defineProperty(copy, key, {
        value: copyDefault(value[key]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    });
    return copy;
  }
  return value;
}

// Assigns the defaults ([{ key, value, empty }]) whose value is missing in `target`: undefined, or with `empty` also
// null or ''.
function assignDefaults(target, defaults) {
  for (let i = 0; i < defaults.length; i += 1) {
    const { key, value, empty } = defaults[i];
    const current = target[key];
    if (current === undefined || (empty && (current === null || current === ''))) {
      target[key] = copyDefault(value);
    }
  }
}

module.exports = {
  copyDefault,
  assignDefaults,
};
