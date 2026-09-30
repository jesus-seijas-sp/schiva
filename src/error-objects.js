// Error objects of compile({ errors: 'objects' }). The generated code keeps the path of each value as an array of keys
// and indexes; these functions name it as the messages do and build the objects. Standalone code writes them out by
// their source (see standalone-helpers.js), so they call no other function.

// The name the messages give to the value at `path`: keys joined with dots, indexes in brackets, "Value" for the
// value itself (and before an index at the root). A last segment { key } is a key checked by propertyNames, named
// "Key <name>". Same names as the string paths of compile.js.
function pathName(path) {
  let name;
  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i];
    if (typeof segment === 'number') {
      name = `${name === undefined ? 'Value' : name}[${segment}]`;
    } else if (segment !== null && typeof segment === 'object') {
      return `Key ${name ? `${name}.${segment.key}` : segment.key}`;
    } else {
      name = name ? `${name}.${segment}` : segment;
    }
  }
  return name === undefined ? 'Value' : name;
}

// An error: the path of the value (keys and indexes) and its JSON Pointer, the keyword that failed with its params,
// and the message. For a key checked by propertyNames, the path is the one of its property, with propertyName: true.
function errorObject(path, keyword, params, message) {
  const last = path[path.length - 1];
  const isPropertyName = last !== null && typeof last === 'object';
  const keys = isPropertyName ? path.slice(0, -1).concat(last.key) : path.slice();
  let pointer = '';
  for (let i = 0; i < keys.length; i += 1) {
    const key = `${keys[i]}`;
    // Escaped only when it has one of the two characters to escape.
    pointer += key.includes('~') || key.includes('/') ? `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}` : `/${key}`;
  }
  const error = { path: keys, pointer, keyword, params, message };
  if (isPropertyName) {
    error.propertyName = true;
  }
  return error;
}

module.exports = {
  pathName,
  errorObject,
};
