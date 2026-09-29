// Length in Unicode code points, as JSON Schema counts it: a surrogate pair is one character. Same as [...value].length
// without building an array.
function codePointLength(value) {
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
      }
    }
    count += 1;
  }
  return count;
}

// A string has between length / 2 and length code points, so the UTF-16 length decides the comparison unless it is
// close to the limit; only then are code points counted.
function hasFewerCodePoints(value, min) {
  return value.length < min || (value.length < 2 * min && codePointLength(value) < min);
}

function hasMoreCodePoints(value, max) {
  return value.length > 2 * max || (value.length > max && codePointLength(value) > max);
}

module.exports = {
  codePointLength,
  hasFewerCodePoints,
  hasMoreCodePoints,
};
