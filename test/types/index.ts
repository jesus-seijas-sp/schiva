// Type tests: compiled with tsc (npm test), not run. Each check fails to compile when a type is not the one expected.
import {
  AllOf,
  AnyOf,
  ArrayOf,
  Boolean,
  ClosedSchema,
  Const,
  Enum,
  Float,
  Infer,
  Integer,
  Never,
  Not,
  OneOf,
  Ref,
  Schema,
  String,
  ValidateType,
  Values,
  arrOf,
  bool,
  compileIsValid,
  compileJsonSchema,
  compileJsonSchemaAsync,
  loadJsonSchemas,
  ajvKeywords,
  builtInFormats,
  inferJsonSchema,
  inferSchemaCode,
  KeywordDefinition,
  compileType,
  enumt,
  fromJsonSchema,
  int,
  oarrOf,
  ostr,
  str,
  toErrors,
  ErrorObject,
  JsonSchemaObject,
  standaloneCode,
  standaloneJsonSchema,
  standaloneModule,
} from '../../src';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function check<T extends true>(): T | undefined {
  return undefined;
}

// Types and their options.
const plainString = String();
check<Equal<Infer<typeof plainString>, string>>();
const optionalString = String({ isMandatory: false });
check<Equal<Infer<typeof optionalString>, string | undefined>>();
const nullableNumber = Float({ isNullable: true, min: 0 });
check<Equal<Infer<typeof nullableNumber>, number | null>>();
const both = Integer({ isMandatory: false, isNullable: true });
check<Equal<Infer<typeof both>, number | null | undefined>>();
const plainBoolean = Boolean();
check<Equal<Infer<typeof plainBoolean>, boolean>>();
const nothing = Never();
check<Equal<Infer<typeof nothing>, never>>();
const status = Enum({ options: ['draft', 'placed'] });
check<Equal<Infer<typeof status>, 'draft' | 'placed'>>();
const values = Values({ values: [1, 'a', null] });
check<Equal<Infer<typeof values>, 1 | 'a' | null>>();
const one = Const('EUR');
check<Equal<Infer<typeof one>, 'EUR'>>();
const notString = Not({ type: String() });
check<Equal<Infer<typeof notString>, {}>>();

// Chained methods.
const chained = String().optional().nullable();
check<Equal<Infer<typeof chained>, string | undefined | null>>();
const requiredAgain = String().optional().required();
check<Equal<Infer<typeof requiredAgain>, string>>();

// Schemas: optional keys, nested objects, options.
const person = new Schema({
  id: String(),
  age: Integer({ min: 18 }),
  tags: ArrayOf({ type: String(), isMandatory: false }),
  address: { city: String(), zip: String({ isNullable: true }) },
});
type Person = Infer<typeof person>;
check<
  Equal<
    Person,
    {
      id: string;
      age: number;
      address: { city: string; zip: string | null };
      tags?: string[] | undefined;
    }
  >
>();
const closed = new ClosedSchema({ id: String() }, { isNullable: true });
check<Equal<Infer<typeof closed>, { id: string } | null>>();
const optionalSchema = new Schema({ id: String() }).optional();
check<Equal<Infer<typeof optionalSchema>, { id: string } | undefined>>();

// Arrays, tuples, combinations.
const lines = ArrayOf({ type: { sku: String(), qty: Integer() }, min: 1 });
check<Equal<Infer<typeof lines>, { sku: string; qty: number }[]>>();
const pair = ArrayOf({ type: [String(), Integer()] as const });
check<Equal<Infer<typeof pair>, [string, number, ...unknown[]]>>();
const strictPair = ArrayOf({ type: [String(), Integer()] as const, additionalType: Boolean() });
check<Equal<Infer<typeof strictPair>, [string, number, ...boolean[]]>>();
const untyped = ArrayOf();
check<Equal<Infer<typeof untyped>, unknown[]>>();
const union = AnyOf({ types: [String(), Integer()] });
check<Equal<Infer<typeof union>, string | number>>();
const exactlyOne = OneOf({ types: [{ kind: Const('a') }, { kind: Const('b'), b: Integer() }] });
check<Equal<Infer<typeof exactlyOne>, { kind: 'a' } | { kind: 'b'; b: number }>>();
const merged = AllOf({ types: [{ a: String() }, { b: Integer() }] });
check<Equal<Infer<typeof merged>, { a: string } & { b: number }>>();

// Short helpers.
const shortString = str();
check<Equal<Infer<typeof shortString>, string>>();
const shortOptional = ostr(1, 10);
check<Equal<Infer<typeof shortOptional>, string | undefined>>();
const shortNullable = int(0, 10, true, true);
check<Equal<Infer<typeof shortNullable>, number | null>>();
const shortFromOptions = str({ min: 1, isMandatory: false });
check<Equal<Infer<typeof shortFromOptions>, string | undefined>>();
const flags = arrOf(bool());
check<Equal<Infer<typeof flags>, boolean[]>>();
const maybeFlags = oarrOf(bool());
check<Equal<Infer<typeof maybeFlags>, boolean[] | undefined>>();
const letters = enumt(['a', 'b']);
check<Equal<Infer<typeof letters>, 'a' | 'b'>>();

// Recursive schemas: the Ref gets the type of the values it stands for.
interface TreeNode {
  value: number;
  children?: TreeNode[];
}
const child = Ref<TreeNode>();
const node = new Schema({ value: Integer(), children: ArrayOf({ type: child, isMandatory: false }) });
child.target = node;
check<Equal<Infer<typeof node>, { value: number; children?: TreeNode[] | undefined }>>();

// Compiled functions: messages, or a type guard.
const validatePerson = person.compile();
const messages: string[] = validatePerson({});
const isPerson = person.compile({ errors: false });
const input: unknown = JSON.parse('{}');
if (isPerson(input)) {
  check<Equal<typeof input, Person>>();
}
if (compileIsValid(status)(input)) {
  check<Equal<typeof input, 'draft' | 'placed'>>();
}
const guard = compileType(lines, { errors: false });
if (guard(input)) {
  check<Equal<typeof input, { sku: string; qty: number }[]>>();
}
if (person.isValid(input)) {
  check<Equal<typeof input, Person>>();
}

// JSON Schema: unknown unless the type is given.
const validateJson = compileJsonSchema({ type: 'string' });
const jsonMessages: string[] = validateJson(1);
const isUser = compileJsonSchema<{ name: string }>(
  { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  { errors: false, draft: '2020-12' }
);
if (isUser(input)) {
  check<Equal<typeof input, { name: string }>>();
}
const converted = fromJsonSchema({ type: 'integer' });
check<Equal<Infer<typeof converted>, unknown>>();

// Types of your own.
class Even extends ValidateType<number> {
  validate(value: unknown, fieldName = 'Value') {
    const presence = super.validate(value, fieldName);
    if (presence !== undefined || value === undefined || value === null) return presence;
    return typeof value === 'number' && value % 2 === 0 ? undefined : `${fieldName} must be even`;
  }
}
const withEven = new Schema({ n: new Even() });
check<Equal<Infer<typeof withEven>, { n: number }>>();
const allMessages: string[] = toErrors(withEven.validate({ n: 3 }));

// The example of the README.
const readmePerson = new Schema({
  id: String(),
  age: Integer({ min: 18 }),
  status: Enum({ options: ['active', 'blocked'] }),
  tags: ArrayOf({ type: String(), isMandatory: false }),
  address: { city: String(), zip: String({ isNullable: true }) },
});
check<
  Equal<
    Infer<typeof readmePerson>,
    {
      id: string;
      age: number;
      status: 'active' | 'blocked';
      address: { city: string; zip: string | null };
      tags?: string[] | undefined;
    }
  >
>();

// Standalone code is a string.
const standaloneSource: string = standaloneCode(person, { errors: false, format: 'esm' });
const moduleSource: string = standaloneModule({ validatePerson: person, validateLines: lines });
const jsonSource: string = standaloneJsonSchema({ type: 'string' }, { draft: '2020-12', format: 'commonjs' });
export { standaloneSource, moduleSource, jsonSource };

// Formats.
const withEmail = new Schema({ email: String({ format: 'email' }) });
check<Equal<Infer<typeof withEmail>, { email: string }>>();
const checkedFormats: string[] = compileJsonSchema({ format: 'date' }, { formats: true })('x');
const someFormats: string[] = compileJsonSchema({ format: 'date' }, { formats: ['date', 'uuid'] })('x');
const ownFormats: string[] = compileJsonSchema({ format: 'phone' }, { formats: { phone: /^[+]/, even: (text) => text.length % 2 === 0, email: true } })('x');
export { checkedFormats, someFormats, ownFormats };

// Error objects.
const personErrors: ErrorObject[] = person.compile({ errors: 'objects' })({});
const firstObject: ErrorObject[] = person.compile({ errors: 'objects', allErrors: false })({});
const jsonErrors: ErrorObject[] = compileJsonSchema({ type: 'string' }, { errors: 'objects' })(1);
const typeErrors: ErrorObject[] = compileType(lines, { errors: 'objects' })([]);
check<Equal<ErrorObject['path'], (string | number)[]>>();
export { personErrors, firstObject, jsonErrors, typeErrors };

// Drafts, strict mode, declared keywords and loading documents.
const draft04: string[] = compileJsonSchema({ type: 'number' }, { draft: 'draft-04', strict: false, keywords: ['x-a'] })(1);
const loadSchema = async (uri: string) => ({ $id: uri, type: 'string' });
const loadedValidator: Promise<(value: unknown) => string[]> = compileJsonSchemaAsync({ $ref: 'https://x.com/a.json' }, { loadSchema });
const loadedGuard = compileJsonSchemaAsync<string>({}, { loadSchema, errors: false });
const loadedDocuments: Promise<{ [uri: string]: unknown }> = loadJsonSchemas({}, { loadSchema });
loadedGuard.then((isString) => check<Equal<typeof isString, (value: unknown) => value is string>>());
export { draft04, loadedValidator, loadedDocuments };

// Keywords of your own.
const evenKeyword: KeywordDefinition = { keyword: 'even', type: 'integer', validate: (value, data) => !value || data % 2 === 0 };
const rangeKeyword: KeywordDefinition = { keyword: 'between', type: 'number', macro: ([a, b]) => ({ minimum: a, maximum: b }) };
const compiled: KeywordDefinition = { keyword: 'div', compile: (n) => (data) => data % n === 0, message: (n) => 'must be divisible by ' + n };
const withKeywords: string[] = compileJsonSchema({}, { keywords: ['x-a', evenKeyword, rangeKeyword, compiled, ...ajvKeywords(['range'])] })(1);
export { withKeywords };

// Options that change the data.
const versions: string[] = compileJsonSchema({}, { formats: { version: { validate: /^\d+$/, compare: (a, b) => Number(a) - Number(b) } } })('1');
export { versions };
const precise: string[] = compileJsonSchema({}, { multipleOfPrecision: 8 })(0.3);
const preciseFloat = Float({ multipleOf: 0.1, multipleOfPrecision: 8 });
export { precise, preciseFloat };
const changing: boolean = compileJsonSchema({}, { useDefaults: 'empty', removeAdditional: 'failing', coerceTypes: 'array', errors: false })({});
export { changing };

// Wrong uses do not compile.
// @ts-expect-error errors is true, false or 'objects'
export const badErrors = person.compile({ errors: 'object' });
// @ts-expect-error there is no such built-in format
export const badFormat2 = String({ format: 'phone' });
// @ts-expect-error a list names built-in formats
export const badFormats = compileJsonSchema({}, { formats: ['phone'] });
// @ts-expect-error there is no such module format
export const badFormat = standaloneCode(person, { format: 'amd' });
// @ts-expect-error a number is not a type
export const notAType = new Schema({ a: 1 });
// @ts-expect-error min is a number
export const badOption = String({ min: 'x' });
// @ts-expect-error there is no such draft
export const badDraft = compileJsonSchema({}, { draft: '2021' });
// @ts-expect-error loadSchema is required
export const noLoader = compileJsonSchemaAsync({}, {});
// @ts-expect-error there is no such removeAdditional
export const badRemove = compileJsonSchema({}, { removeAdditional: 'some' });
// @ts-expect-error keywords are names or definitions
export const badKeywords = compileJsonSchema({}, { keywords: [1] });
// @ts-expect-error a definition has one function
export const twoFunctions: KeywordDefinition = { keyword: 'x', validate: () => true, macro: () => ({}) };
// @ts-expect-error a macro checks objects, arrays, strings or numbers
export const macroType: KeywordDefinition = { keyword: 'x', type: 'boolean', macro: () => ({}) };
// @ts-expect-error there is no such keyword in ajv-keywords
export const badAjvKeyword = ajvKeywords(['transform']);
// @ts-expect-error options of an Enum are strings
export const badEnum = Enum({ options: [1, 2] });

// Inferred schemas and built-in formats.
const inferred: JsonSchemaObject = inferJsonSchema([{ a: 1 }], { closed: true, formats: false, draft: 'draft-07' });
const inferredCode: string = inferSchemaCode([{ a: 1 }, { a: 'x' }], { name: 'order', module: 'esm' });
const allFormats: { email: true } = builtInFormats();
export { inferred, inferredCode, allFormats };
// @ts-expect-error samples are a list
export const badSamples = inferJsonSchema({ a: 1 });
// @ts-expect-error there is no such module
export const badModule = inferSchemaCode([1], { module: 'amd' });

export { messages, jsonMessages, allMessages };
