const { compileJsonSchemaAsync, loadJsonSchemas, standaloneJsonSchema } = require('../src');

const documents = {
  'https://example.com/address.json': {
    $id: 'https://example.com/address.json',
    type: 'object',
    properties: { country: { $ref: 'country.json' } },
  },
  'https://example.com/country.json': { type: 'string', enum: ['ES', 'FR'] },
};

// A loadSchema that records the URIs it is asked for.
function loader() {
  const calls = [];
  const loadSchema = async (uri) => {
    calls.push(uri);
    if (!documents[uri]) {
      throw new Error(`Not found: ${uri}`);
    }
    return documents[uri];
  };
  return { calls, loadSchema };
}

const schema = { type: 'object', properties: { address: { $ref: 'https://example.com/address.json' } } };

describe('Loading referenced documents', () => {
  it('Should load the documents a schema references, and the ones they reference, once each', async () => {
    const { calls, loadSchema } = loader();
    const validate = await compileJsonSchemaAsync(schema, { loadSchema });
    expect(validate({ address: { country: 'XX' } })).toEqual(['address.country must be one of: ES, FR']);
    expect(calls).toEqual(['https://example.com/address.json', 'https://example.com/country.json']);
  });

  it('Should not load the documents the option "schemas" has', async () => {
    const { calls, loadSchema } = loader();
    const schemas = [documents['https://example.com/address.json']];
    const validate = await compileJsonSchemaAsync(schema, { loadSchema, schemas, errors: false });
    expect(validate({ address: { country: 'ES' } })).toBe(true);
    expect(calls).toEqual(['https://example.com/country.json']);
  });

  it('Should give the documents for compileJsonSchema() or standaloneJsonSchema()', async () => {
    const { loadSchema } = loader();
    const schemas = await loadJsonSchemas(schema, { loadSchema });
    expect(Object.keys(schemas)).toEqual(['https://example.com/address.json', 'https://example.com/country.json']);
    expect(standaloneJsonSchema(schema, { schemas })).toContain('address');
  });

  it('Should pass on the errors of loadSchema', async () => {
    const { loadSchema } = loader();
    await expect(compileJsonSchemaAsync({ $ref: 'https://example.com/none.json' }, { loadSchema })).rejects.toThrow(
      'Not found: https://example.com/none.json'
    );
  });

  it('Should throw when a loaded document does not have the target', async () => {
    const { calls, loadSchema } = loader();
    await expect(
      compileJsonSchemaAsync({ $ref: 'https://example.com/address.json#/nope' }, { loadSchema })
    ).rejects.toThrow('only references within the schema or to documents in the "schemas" option are supported');
    expect(calls).toEqual(['https://example.com/address.json']);
  });

  it('Should not load references relative to a schema without "$id"', async () => {
    const { calls, loadSchema } = loader();
    await expect(compileJsonSchemaAsync({ $ref: 'other.json' }, { loadSchema })).rejects.toThrow(
      'Unsupported JSON Schema "$ref": "other.json"'
    );
    expect(calls).toEqual([]);
  });

  it('Should require loadSchema', async () => {
    await expect(compileJsonSchemaAsync({})).rejects.toThrow(
      'Unsupported JSON Schema option "loadSchema": expected an async function (uri) => schema'
    );
  });
});
