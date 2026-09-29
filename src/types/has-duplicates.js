const { deepEqual } = require('../deep-equal');

// An element is a duplicate when an earlier index (holes read as undefined) is deep-equal to it.
// Primitive arrays use a Set, which has the same equality as deepEqual for primitives (NaN included).
function hasDuplicates(value) {
  if (value.some((item) => item !== null && typeof item === 'object')) {
    return value.some((item, i) => value.findIndex((other) => deepEqual(item, other)) !== i);
  }
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    if (i in value && seen.has(value[i])) {
      return true;
    }
    seen.add(value[i]);
  }
  return false;
}

module.exports = {
  hasDuplicates,
};
