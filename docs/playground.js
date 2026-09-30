// The playground (playground.html): compiles the schema of the editor with schiva (schiva.js, the browser build) and
// shows what the compiled function returns for the value. run() does the work and the rest is the page; run() also
// loads in Node, where the examples are tested.
(function () {
  'use strict';

  var MODES = {
    messages: {},
    first: { allErrors: false },
    objects: { errors: 'objects' },
    boolean: { errors: false },
  };

  // The names of schiva, available to the code of the editors as after import { ... } from 'schiva'.
  function scopeOf(schiva) {
    var names = Object.keys(schiva).filter(function (name) {
      return /^[A-Za-z_$][\w$]*$/.test(name);
    });
    return {
      names: names,
      values: names.map(function (name) {
        return schiva[name];
      }),
    };
  }

  function evaluate(scope, body) {
    // eslint-disable-next-line no-new-func -- running the code of the editors is the point of the playground
    return Function.apply(null, scope.names.concat(body)).apply(null, scope.values);
  }

  function failure(where, error) {
    return { ok: false, where: where, message: error && error.message ? error.message : String(error) };
  }

  // Stable text of a value to compare it before and after validating, and to show it.
  function show(value) {
    if (value === undefined) {
      return 'undefined';
    }
    try {
      var text = JSON.stringify(
        value,
        function (key, item) {
          if (item === undefined) {
            return '__undefined__';
          }
          if (typeof item === 'number' && !Number.isFinite(item)) {
            return String(item);
          }
          if (typeof item === 'bigint') {
            return item + 'n';
          }
          return item;
        },
        2
      );
      return text === undefined ? String(value) : text.replace(/"__undefined__"/g, 'undefined');
    } catch (e) {
      return String(value);
    }
  }

  // input: { language: 'js' | 'json', schema, value, options, mode }. Returns { ok: true, result, valid, errors,
  // changed, after, code, perSecond } or { ok: false, where, message }.
  function run(schiva, input) {
    var scope = scopeOf(schiva);
    var options;
    try {
      options = input.options.trim() ? evaluate(scope, 'return (' + input.options + '\n);') : {};
      if (options === null || typeof options !== 'object') {
        throw new Error('The options must be an object, such as { formats: true }');
      }
    } catch (e) {
      return failure('options', e);
    }
    var compileOptions = Object.assign({}, options, MODES[input.mode] || {});

    var validate;
    var started = now();
    try {
      if (input.language === 'json') {
        var json;
        try {
          json = JSON.parse(input.schema);
        } catch (e) {
          throw new Error('The schema is not valid JSON: ' + e.message);
        }
        validate = schiva.compileJsonSchema(json, compileOptions);
      } else {
        var schema = evaluate(scope, input.schema + '\n;return typeof schema === "undefined" ? undefined : schema;');
        if (schema === undefined) {
          throw new Error('Define the schema in a variable named schema: const schema = new Schema({ ... });');
        }
        validate = typeof schema.compile === 'function' ? schema.compile(compileOptions) : schiva.compileType(schema, compileOptions);
      }
    } catch (e) {
      return failure('schema', e);
    }
    var compileMs = now() - started;

    var value;
    var readValue = function () {
      return input.value.trim() ? evaluate({ names: [], values: [] }, 'return (' + input.value + '\n);') : undefined;
    };
    try {
      value = readValue();
    } catch (e) {
      return failure('value', e);
    }

    var before = show(value);
    var result;
    try {
      result = validate(value);
    } catch (e) {
      return failure('validate', e);
    }
    var after = show(value);

    return {
      ok: true,
      result: result,
      valid: result === true || (Array.isArray(result) && result.length === 0),
      changed: before !== after,
      after: after,
      code: validate.toString(),
      compileMs: compileMs,
      perSecond: before === after ? speedOf(validate, value) : undefined,
    };
  }

  function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  // Validations per second of the value, measured for about 30 ms.
  function speedOf(validate, value) {
    var count = 0;
    var batch = 100;
    var started = now();
    var elapsed = 0;
    while (elapsed < 30) {
      for (var i = 0; i < batch; i += 1) {
        validate(value);
      }
      count += batch;
      batch *= 2;
      elapsed = now() - started;
    }
    return (count / elapsed) * 1000;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { run: run, show: show };
    return;
  }

  // The page.

  var examples = window.PLAYGROUND_EXAMPLES;
  var $ = function (id) {
    return document.getElementById(id);
  };
  var state = { language: 'js' };
  var timer;

  function encode(data) {
    var bytes = new TextEncoder().encode(JSON.stringify(data));
    var text = '';
    bytes.forEach(function (byte) {
      text += String.fromCharCode(byte);
    });
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decode(text) {
    var binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function fillExamples() {
    var select = $('example');
    var groups = {};
    examples.forEach(function (example) {
      if (!groups[example.group]) {
        groups[example.group] = document.createElement('optgroup');
        groups[example.group].label = example.group;
        select.appendChild(groups[example.group]);
      }
      var option = document.createElement('option');
      option.value = example.id;
      option.textContent = example.title;
      groups[example.group].appendChild(option);
    });
  }

  function setLanguage(language) {
    state.language = language;
    $('language').textContent = language === 'json' ? 'JSON Schema (JSON)' : 'Schema DSL (JavaScript)';
    $('schema').setAttribute('aria-label', language === 'json' ? 'JSON Schema' : 'Schema, JavaScript code');
  }

  function load(example) {
    $('example').value = example.id;
    $('hint').textContent = example.hint;
    $('schema').value = example.schema;
    $('value').value = example.value;
    $('options').value = example.options;
    setLanguage(example.language);
    update();
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function formatNumber(value) {
    if (value >= 1e6) {
      return (value / 1e6).toFixed(value >= 1e7 ? 0 : 1) + ' million';
    }
    return Math.round(value).toLocaleString('en-US');
  }

  var WHERE = {
    schema: 'The schema has a problem',
    value: 'The value is not valid JavaScript',
    options: 'The options have a problem',
    validate: 'The validation function threw',
  };

  function render(output, mode) {
    var box = $('result');
    box.textContent = '';
    ['schema', 'value', 'options'].forEach(function (name) {
      $(name).classList.toggle('pg-invalid', !output.ok && output.where === name);
    });

    if (!output.ok) {
      box.className = 'pg-result is-problem';
      box.appendChild(el('p', 'pg-status', WHERE[output.where]));
      box.appendChild(el('pre', 'pg-message', output.message));
      $('code').textContent = '';
      $('code-section').hidden = true;
      return;
    }

    box.className = 'pg-result ' + (output.valid ? 'is-valid' : 'is-invalid');
    var count = Array.isArray(output.result) ? output.result.length : 0;
    var status = output.valid
      ? 'Valid'
      : mode === 'boolean'
        ? 'Not valid'
        : count === 1
          ? '1 error'
          : count + ' errors';
    box.appendChild(el('p', 'pg-status', status));

    if (!output.valid && Array.isArray(output.result)) {
      var list = el('ul', 'pg-errors');
      output.result.forEach(function (error) {
        var item = el('li');
        if (typeof error === 'string') {
          item.textContent = error;
        } else {
          item.appendChild(el('span', 'pg-error-message', error.message));
          item.appendChild(el('pre', 'pg-error-object', show(error)));
        }
        list.appendChild(item);
      });
      box.appendChild(list);
    }

    var returns = el('p', 'pg-returns');
    returns.appendChild(el('code', '', 'validate(value)'));
    returns.appendChild(document.createTextNode(' returned '));
    var returned = show(output.result);
    if (Array.isArray(output.result) && output.result.length) {
      var kind = mode === 'objects' ? 'error object' : 'message';
      returned = 'an array of ' + output.result.length + ' ' + kind + (output.result.length === 1 ? '' : 's');
      returns.appendChild(document.createTextNode(returned + (mode === 'first' ? ' (it stops at the first error)' : '')));
    } else {
      returns.appendChild(el('code', '', returned));
    }
    box.appendChild(returns);

    if (output.changed) {
      box.appendChild(el('p', 'pg-after-title', 'The options changed the value. After validating, it is:'));
      box.appendChild(el('pre', 'pg-after', output.after));
    }

    var speed = el('p', 'pg-speed');
    speed.textContent =
      'Compiled in ' +
      (output.compileMs < 1 ? output.compileMs.toFixed(2) : output.compileMs.toFixed(1)) +
      ' ms' +
      (output.perSecond ? ', then about ' + formatNumber(output.perSecond) + ' validations of this value per second in your browser.' : '.');
    box.appendChild(speed);

    $('code-section').hidden = false;
    var code = $('code');
    code.textContent = output.code;
    code.removeAttribute('data-highlighted');
    if (window.hljs && output.code.length < 40000) {
      window.hljs.highlightElement(code);
    }
  }

  function update() {
    var mode = $('mode').value;
    var output = run(window.schiva, {
      language: state.language,
      schema: $('schema').value,
      value: $('value').value,
      options: $('options').value,
      mode: mode,
    });
    render(output, mode);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, 250);
  }

  function share(button) {
    var data = {
      l: state.language,
      s: $('schema').value,
      v: $('value').value,
      o: $('options').value,
      m: $('mode').value,
    };
    var url = location.href.split('#')[0] + '#' + encode(data);
    history.replaceState(null, '', url);
    var label = button.textContent;
    var done = function (text) {
      button.textContent = text;
      setTimeout(function () {
        button.textContent = label;
      }, 1600);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(
        function () {
          done('Link copied');
        },
        function () {
          done('Link in the address bar');
        }
      );
    } else {
      done('Link in the address bar');
    }
  }

  function fromHash() {
    if (location.hash.length < 2) {
      return false;
    }
    try {
      var data = decode(location.hash.slice(1));
      $('example').value = '';
      $('hint').textContent = 'A shared playground. Choose an example to start from another one.';
      $('schema').value = data.s || '';
      $('value').value = data.v || '';
      $('options').value = data.o || '';
      if (MODES[data.m]) {
        $('mode').value = data.m;
      }
      setLanguage(data.l === 'json' ? 'json' : 'js');
      update();
      return true;
    } catch (e) {
      return false;
    }
  }

  // Tab inserts two spaces instead of leaving the editor; Escape then Tab leaves it.
  function indentOnTab(textarea) {
    var escaped = false;
    textarea.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        escaped = true;
        return;
      }
      if (event.key !== 'Tab' || escaped || event.shiftKey) {
        escaped = false;
        return;
      }
      event.preventDefault();
      var start = textarea.selectionStart;
      textarea.setRangeText('  ', start, textarea.selectionEnd, 'end');
      schedule();
    });
    textarea.addEventListener('blur', function () {
      escaped = false;
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    fillExamples();
    ['schema', 'value', 'options'].forEach(function (id) {
      $(id).addEventListener('input', schedule);
      indentOnTab($(id));
    });
    $('mode').addEventListener('change', update);
    $('example').addEventListener('change', function () {
      var example = examples.find(function (item) {
        return item.id === $('example').value;
      });
      if (example) {
        history.replaceState(null, '', location.href.split('#')[0]);
        load(example);
      }
    });
    $('share').addEventListener('click', function () {
      share($('share'));
    });
    $('reset').addEventListener('click', function () {
      var example =
        examples.find(function (item) {
          return item.id === $('example').value;
        }) || examples[0];
      history.replaceState(null, '', location.href.split('#')[0]);
      load(example);
    });
    if (!fromHash()) {
      load(examples[0]);
    }
  });
})();
