function deepEqual(a, b) {
  if (a === b) return true;
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (a.constructor !== b.constructor) return false;
    if (Array.isArray(a)) {
      const l = a.length;
      if (l !== b.length) return false;
      for (let i = 0; i < l; i += 1) {
        if (!deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    if (a instanceof Map && b instanceof Map) {
      if (a.size !== b.size) return false;
      const keys = [...a.keys()];
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        if (!b.has(key)) return false;
      }
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        if (!deepEqual(a.get(key), b.get(key))) return false;
      }
      return true;
    }
    if (a instanceof Set && b instanceof Set) {
      if (a.size !== b.size) return false;
      const keys = [...a.keys()];
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        if (!b.has(key)) return false;
      }
      return true;
    }
    if (ArrayBuffer.isView(a)) {
      const l = a.length;
      if (l !== b.length) return false;
      for (let i = 0; i < l; i += 1) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }
    if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
    if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
    if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

module.exports = { deepEqual };
