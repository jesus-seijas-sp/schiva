// Schema from JSON (infer.html): infers the schema of the samples with schiva (schiva.js, the browser build) and shows
// it as the DSL or as JSON Schema, with a link that opens it in the playground.
(function () {
  'use strict';

  var EXAMPLES = [
    '{\n  "id": "0b4a7c1e-1d2f-4e5a-9b8c-7d6e5f4a3b2c",\n  "customer": { "name": "Ann", "email": "ann@example.com" },\n  "createdAt": "2026-09-30T10:00:00Z",\n  "status": "placed",\n  "lines": [\n    { "sku": "A-1", "qty": 2, "price": 9.5 },\n    { "sku": "B-2", "qty": 1, "price": 20, "gift": true }\n  ],\n  "coupon": null\n}',
    '{\n  "id": "1c5b8d2f-2e3a-4f6b-8c9d-8e7f6a5b4c3d",\n  "customer": { "name": "Bob", "email": "bob@example.com", "phone": "+34 600 000 000" },\n  "createdAt": "2026-09-29T18:30:00Z",\n  "status": "draft",\n  "lines": [{ "sku": "C-3", "qty": 5, "price": 3 }],\n  "coupon": "WELCOME"\n}',
  ];

  var $ = function (id) {
    return document.getElementById(id);
  };
  var state = { view: 'js', result: null };
  var timer;

  // The same encoding as the playground's links (playground.js).
  function encode(data) {
    var bytes = new TextEncoder().encode(JSON.stringify(data));
    var text = '';
    bytes.forEach(function (byte) {
      text += String.fromCharCode(byte);
    });
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function addSample(text) {
    var list = $('samples');
    var item = document.createElement('div');
    item.className = 'inf-sample';
    var head = document.createElement('div');
    head.className = 'inf-sample-head';
    var label = document.createElement('span');
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'inf-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', function () {
      item.remove();
      renumber();
      update();
    });
    head.appendChild(label);
    head.appendChild(remove);
    var area = document.createElement('textarea');
    area.spellcheck = false;
    area.setAttribute('autocapitalize', 'off');
    area.setAttribute('wrap', 'off');
    area.value = text;
    area.addEventListener('input', schedule);
    item.appendChild(head);
    item.appendChild(area);
    list.appendChild(item);
    renumber();
    return area;
  }

  function renumber() {
    var items = $('samples').querySelectorAll('.inf-sample');
    items.forEach(function (item, index) {
      item.querySelector('span').textContent = 'Sample ' + (index + 1);
      item.querySelector('textarea').setAttribute('aria-label', 'JSON sample ' + (index + 1));
      item.querySelector('.inf-remove').hidden = items.length === 1;
    });
  }

  // The samples, or { problem } for the first one that is not valid JSON.
  function readSamples() {
    var samples = [];
    var texts = [];
    var areas = $('samples').querySelectorAll('textarea');
    for (var i = 0; i < areas.length; i += 1) {
      var text = areas[i].value.trim();
      if (text) {
        var value;
        try {
          value = JSON.parse(text);
        } catch (e) {
          return { problem: 'Sample ' + (i + 1) + ' is not valid JSON: ' + e.message };
        }
        if ($('split').checked && Array.isArray(value)) {
          value.forEach(function (item) {
            samples.push(item);
            texts.push(JSON.stringify(item, null, 2));
          });
        } else {
          samples.push(value);
          texts.push(text);
        }
      }
    }
    if (samples.length === 0) {
      return { problem: 'Paste a JSON sample to start.' };
    }
    return { samples: samples, texts: texts };
  }

  function options() {
    return { closed: $('closed').checked, formats: $('formats').checked, draft: $('draft').value };
  }

  function update() {
    var read = readSamples();
    var problem = $('problem');
    if (read.problem) {
      problem.hidden = false;
      problem.textContent = read.problem;
      state.result = null;
      $('try').disabled = true;
      $('summary').textContent = '';
      show();
      return;
    }
    try {
      var settings = options();
      state.result = {
        samples: read.samples,
        texts: read.texts,
        json: window.schiva.inferJsonSchema(read.samples, settings),
        code: window.schiva.inferSchemaCode(read.samples, Object.assign({ module: $('module').value }, settings)),
        playgroundCode: window.schiva.inferSchemaCode(read.samples, Object.assign({ module: 'none' }, settings)),
        formats: settings.formats,
      };
      problem.hidden = true;
      $('try').disabled = false;
      $('summary').textContent =
        'From ' + read.samples.length + ' sample' + (read.samples.length === 1 ? '' : 's') + '.';
    } catch (e) {
      problem.hidden = false;
      problem.textContent = e.message;
      state.result = null;
      $('try').disabled = true;
    }
    show();
  }

  function show() {
    var code = $('output');
    var result = state.result;
    var isJson = state.view === 'json';
    $('show-js').setAttribute('aria-selected', String(!isJson));
    $('show-json').setAttribute('aria-selected', String(isJson));
    code.className = isJson ? 'language-json' : 'language-js';
    code.textContent = result ? (isJson ? JSON.stringify(result.json, null, 2) : result.code) : '';
    code.removeAttribute('data-highlighted');
    if (window.hljs && result) {
      window.hljs.highlightElement(code);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, 250);
  }

  // Opens the schema in the playground, with the first sample as the value to check.
  function tryIt() {
    var result = state.result;
    if (!result) {
      return;
    }
    var isJson = state.view === 'json';
    var data = {
      l: isJson ? 'json' : 'js',
      s: isJson ? JSON.stringify(result.json, null, 2) : result.playgroundCode,
      v: result.texts[0],
      o: isJson && result.formats ? '{ formats: true }' : '{}',
      m: 'messages',
    };
    location.href = 'playground.html#' + encode(data);
  }

  document.addEventListener('DOMContentLoaded', function () {
    EXAMPLES.forEach(addSample);
    $('add').addEventListener('click', function () {
      addSample('').focus();
    });
    ['split', 'closed', 'formats', 'draft', 'module'].forEach(function (id) {
      $(id).addEventListener('change', update);
    });
    $('show-js').addEventListener('click', function () {
      state.view = 'js';
      show();
    });
    $('show-json').addEventListener('click', function () {
      state.view = 'json';
      show();
    });
    $('try').addEventListener('click', tryIt);
    update();
  });
})();
