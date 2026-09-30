// Type declarations of schiva. Every type records the values it accepts in its type parameter `Out`, including
// undefined and null when it accepts them, so Infer<typeof type> gives the TypeScript type of the values it validates.

declare const OUTPUT: unique symbol;

// ---------------------------------------------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------------------------------------------

/** Anything that validates values: a type, a schema, or a plain object of types (which stands for a Schema). */
export type ShapeValue = SchivaType<any> | Shape;

/**
 * The keys of a Schema, each with the type of its value (a plain object is a nested Schema). Undefined is accepted
 * for the keys TypeScript adds to the object literals of a union, and InferShape leaves them out.
 */
export interface Shape {
  [key: string]: ShapeValue | undefined;
}

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void
  ? I
  : never;

// Keys of a plain object of types. A key whose type is undefined is left out: TypeScript adds them to the object
// literals of a union (an array of alternatives), for the keys the other alternatives have.
type ShapeKeys<S> = { [K in keyof S]-?: [S[K]] extends [undefined] ? never : K }[keyof S];

/** The values of a plain object of types: a key whose type accepts undefined is optional. */
export type InferShape<S> = Simplify<
  { [K in ShapeKeys<S> as undefined extends Infer<S[K]> ? never : K]: Infer<S[K]> } & {
    [K in ShapeKeys<S> as undefined extends Infer<S[K]> ? K : never]?: Infer<S[K]>;
  }
>;

/** The TypeScript type of the values that a type, a schema or a plain object of types accepts. */
export type Infer<T> = T extends { readonly [OUTPUT]: infer O } ? O : T extends object ? InferShape<T> : never;

/** A value that is neither undefined nor null. */
type Present = NonNullable<unknown>;

type Merge<A, B> = Simplify<Omit<A, keyof B> & B>;

// The values of a type with options `O`: `T`, and undefined unless it is mandatory (the default), and null when it
// is nullable (not the default). A boolean that is not a literal counts as possibly true.
type WithPresence<T, O> =
  | T
  | (O extends { isMandatory: infer M } ? (false extends M ? undefined : never) : never)
  | (O extends { isNullable: infer N } ? (true extends N ? null : never) : never);

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------

/** What validate() returns: undefined when valid, else a message or a (possibly nested) list of messages. */
export type ValidationResult = string | undefined | ValidationResult[];

/** Options of compile(), compileType() and compileJsonSchema(). */
export interface CompileOptions {
  /** false: only the first error message (the function stops at the first failing check). Default true. */
  allErrors?: boolean;
  /**
   * true (default): the error messages. 'objects': errors as objects (see ErrorObject). false: the function returns
   * true or false and builds no messages.
   */
  errors?: boolean | 'objects';
}

/** An error, with errors: 'objects'. */
export interface ErrorObject {
  /** The path of the value: keys and indexes, [] for the value itself. */
  path: (string | number)[];
  /** The same path as a JSON Pointer, '' for the value itself. */
  pointer: string;
  /** The check that failed: a keyword of JSON Schema where there is one ('minimum', 'required', 'type'...). */
  keyword: string;
  /** Its details: the limit, the allowed values, the unexpected key... */
  params: { [name: string]: unknown };
  /** The same message as with errors: true. */
  message: string;
  /** True for a key checked by propertyNames, whose path is the one of its property. */
  propertyName?: true;
}

/** A function returning the errors of a value as objects ([] when valid), or only the first with allErrors: false. */
export type ErrorObjectsFunction = (value: unknown) => ErrorObject[];

/** A function returning every error message of a value, or only the first with allErrors: false; [] when valid. */
export type ErrorsFunction = (value: unknown) => string[];

/** A function telling whether a value is valid, as a type guard. */
export type IsValidFunction<Out> = (value: unknown) => value is Out;

/** What a type, a schema, and the result of fromJsonSchema() have in common. */
export interface SchivaType<Out = unknown> {
  /** Type only (never set): the values accepted, including undefined and null when accepted. */
  readonly [OUTPUT]: Out;
  isMandatory: boolean;
  isNullable: boolean;
  /** Checks without compiling. */
  isValid(value: unknown): value is Out;
  /** Checks without compiling: undefined when valid, else the error messages (see toErrors()). */
  validate(value: unknown, fieldName?: string): ValidationResult;
  /** The error messages of a value already known to be invalid. */
  errors(value: unknown, fieldName?: string): ValidationResult;
  /** Compiles into a function checking a value; it does not see changes made to the type afterwards. */
  compile(options: CompileOptions & { errors: false }): IsValidFunction<Out>;
  compile(options: CompileOptions & { errors: 'objects' }): ErrorObjectsFunction;
  compile(options?: CompileOptions & { errors?: true }): ErrorsFunction;
  compile(options: CompileOptions): ErrorsFunction | ErrorObjectsFunction | IsValidFunction<Out>;
}

// ---------------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------------

/** Options every type takes. */
export interface TypeOptions {
  /** Default true: undefined is an error. */
  isMandatory?: boolean;
  /** Default false: null is an error. */
  isNullable?: boolean;
}

/** Base class of every type, to extend with types of your own that override validate() or isValid(). */
export class ValidateType<Out = unknown> implements SchivaType<Out> {
  readonly [OUTPUT]: Out;
  constructor(options?: TypeOptions);
  isMandatory: boolean;
  isNullable: boolean;
  isValid(value: unknown): value is Out;
  validate(value: unknown, fieldName?: string): ValidationResult;
  errors(value: unknown, fieldName?: string): ValidationResult;
  compile(options: CompileOptions & { errors: false }): IsValidFunction<Out>;
  compile(options: CompileOptions & { errors: 'objects' }): ErrorObjectsFunction;
  compile(options?: CompileOptions & { errors?: true }): ErrorsFunction;
  compile(options: CompileOptions): ErrorsFunction | ErrorObjectsFunction | IsValidFunction<Out>;
  /** Whether undefined, or null, decides the result: a boolean, or undefined for other values. */
  checkPresence(value: unknown): boolean | undefined;
  mandatory(isMandatory?: true): ValidateType<Exclude<Out, undefined>>;
  mandatory(isMandatory: false): ValidateType<Out | undefined>;
  mandatory(isMandatory: boolean): ValidateType<Out | undefined>;
  nullable(isNullable?: true): ValidateType<Out | null>;
  nullable(isNullable: false): ValidateType<Exclude<Out, null>>;
  nullable(isNullable: boolean): ValidateType<Out | null>;
  optional(): ValidateType<Out | undefined>;
  required(): ValidateType<Exclude<Out, undefined>>;
  notNull(): ValidateType<Exclude<Out, null>>;
}

/** The built-in formats. */
export type FormatName =
  | 'date'
  | 'time'
  | 'date-time'
  | 'duration'
  | 'email'
  | 'idn-email'
  | 'hostname'
  | 'idn-hostname'
  | 'ipv4'
  | 'ipv6'
  | 'uri'
  | 'uri-reference'
  | 'iri'
  | 'iri-reference'
  | 'uuid'
  | 'uri-template'
  | 'json-pointer'
  | 'relative-json-pointer'
  | 'regex';

/** A check of a format: a regular expression the string must match, or a function telling whether it has it. */
export type FormatCheck = RegExp | ((value: string) => boolean);

/**
 * A format of your own whose values can be compared, for formatMinimum, formatMaximum, formatExclusiveMinimum and
 * formatExclusiveMaximum: compare(a, b) gives a negative number, 0 or a positive number, or undefined (which passes).
 */
export interface FormatDefinition {
  validate: FormatCheck;
  compare?: (a: string, b: string) => number | undefined;
}

export interface StringOptions extends TypeOptions {
  /** Minimum length. */
  min?: number;
  /** Maximum length. */
  max?: number;
  pattern?: RegExp;
  /** Whether '' is valid (default true). */
  allowEmpty?: boolean;
  /** Count lengths in Unicode code points instead of UTF-16 units. */
  countCodePoints?: boolean;
  /** A built-in format the string must have. */
  format?: FormatName;
}
export class StringType<Out = string> extends ValidateType<Out> {
  constructor(options?: StringOptions);
  min?: number;
  max?: number;
  pattern?: RegExp;
  allowEmpty?: boolean;
  countCodePoints?: boolean;
  format?: string;
  formatCheck?: FormatCheck;
}

export interface NumberOptions extends TypeOptions {
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
  multipleOf?: number;
  /** Decimal digits: a division by multipleOf within 1e-multipleOfPrecision of an integer passes (0.3 of 0.1). */
  multipleOfPrecision?: number;
}
export class FloatType<Out = number> extends ValidateType<Out> {
  constructor(options?: NumberOptions);
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
  multipleOf?: number;
  multipleOfPrecision?: number;
}
export class IntegerType<Out = number> extends FloatType<Out> {}

export class BooleanType<Out = boolean> extends ValidateType<Out> {}
export class AnyType<Out = Present> extends ValidateType<Out> {}
export class NeverType<Out = never> extends ValidateType<Out> {}

export interface EnumOptions<T extends string = string> extends TypeOptions {
  options: readonly T[];
}
export class EnumType<Out = string> extends StringType<Out> {
  constructor(options?: EnumOptions);
  options: readonly string[];
}

/** Values that Values and Const compare deeply. */
export type Literal = string | number | boolean | null | undefined | object;

export interface ValuesOptions<T extends Literal = Literal> extends TypeOptions {
  values: readonly T[];
}
export class ValuesType<Out = unknown> extends ValidateType<Out> {
  constructor(options?: ValuesOptions);
  values: readonly unknown[];
}

/** Items of an ArrayOf: one type for every element, or a tuple of types. */
export type ArrayItems = ShapeValue | readonly [] | readonly [ShapeValue, ...ShapeValue[]];

export interface ArrayOfOptions extends TypeOptions {
  type?: ArrayItems;
  min?: number;
  max?: number;
  unique?: boolean;
  /** At least one element (or between minContains and maxContains) must satisfy it. */
  contains?: ShapeValue;
  minContains?: number;
  maxContains?: number;
  /** With a tuple, the type of the elements after it. */
  additionalType?: ShapeValue;
}

type InferTuple<T> = { -readonly [K in keyof T]: Infer<T[K]> };
type InferItems<T, A> = [T] extends [never]
  ? unknown[]
  : T extends readonly unknown[]
    ? [...InferTuple<T>, ...([A] extends [never] ? unknown[] : Infer<A>[])]
    : Infer<T>[];

export class ArrayOfType<Out = unknown[]> extends ValidateType<Out> {
  constructor(options?: ArrayOfOptions);
  type?: SchivaType | readonly SchivaType[];
  min?: number;
  max?: number;
  unique?: boolean;
  contains?: SchivaType;
  minContains?: number;
  maxContains?: number;
  additionalType?: SchivaType;
}

export interface TypesOptions extends TypeOptions {
  types?: readonly ShapeValue[];
}
export class AllOfType<Out = unknown> extends ValidateType<Out> {
  constructor(options?: TypesOptions);
  types: SchivaType[];
}
export class AnyOfType<Out = unknown> extends ValidateType<Out> {
  constructor(options?: TypesOptions);
  types: SchivaType[];
}
export class OneOfType<Out = unknown> extends ValidateType<Out> {
  constructor(options?: TypesOptions);
  types: SchivaType[];
}

export interface NotOptions extends TypeOptions {
  type?: ShapeValue;
}
export class NotType<Out = Present> extends ValidateType<Out> {
  constructor(options?: NotOptions);
  type?: SchivaType;
}

export interface ConditionalOptions extends TypeOptions {
  ifType?: ShapeValue;
  thenType?: ShapeValue;
  elseType?: ShapeValue;
}
export class ConditionalType<Out = Present> extends ValidateType<Out> {
  constructor(options?: ConditionalOptions);
  ifType?: SchivaType;
  thenType?: SchivaType;
  elseType?: SchivaType;
}

/** JSON types that When checks. */
export type WhenJsonType = 'object' | 'array' | 'string' | 'number';
export interface WhenOptions extends TypeOptions {
  jsonType: WhenJsonType;
  type?: ShapeValue;
}
/** The JSON types a keyword of your own can be limited to. */
export type KeywordJsonType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

/** What a keyword of your own receives besides its value and schema. */
export interface KeywordContext {
  /** The draft of the schema. */
  draft: JsonSchemaDraft;
}

interface KeywordDefinitionBase {
  /** Its name in schemas; not one of JSON Schema. */
  keyword: string;
  /** The JSON types of the values it checks; every value by default. */
  type?: KeywordJsonType | readonly KeywordJsonType[];
}

/** A keyword of your own whose function checks the data. */
export interface CheckKeywordDefinition extends KeywordDefinitionBase {
  /** The text after the name of the value in its error, or a function giving it; 'must pass the "<keyword>" keyword' by default. */
  message?: string | ((value: any, data: unknown) => string);
}

/** A keyword of your own checked by validate(value of the keyword, data, schema), called for every value. */
export interface ValidateKeywordDefinition extends CheckKeywordDefinition {
  validate: (value: any, data: any, parentSchema: JsonSchemaObject) => boolean;
  compile?: never;
  macro?: never;
}

/** A keyword of your own whose compile(value of the keyword, schema) gives, once, the function (or regular expression) checking the data. */
export interface CompileKeywordDefinition extends CheckKeywordDefinition {
  compile: (value: any, parentSchema: JsonSchemaObject, it: KeywordContext) => ((data: any) => boolean) | RegExp;
  validate?: never;
  macro?: never;
}

/** A keyword of your own that is other keywords: macro(value of the keyword, schema) gives the schema to check. */
export interface MacroKeywordDefinition extends KeywordDefinitionBase {
  type?: 'object' | 'array' | 'string' | 'number' | readonly ('object' | 'array' | 'string' | 'number')[];
  macro: (value: any, parentSchema: JsonSchemaObject, it: KeywordContext) => JsonSchema;
  validate?: never;
  compile?: never;
}

export type KeywordDefinition = ValidateKeywordDefinition | CompileKeywordDefinition | MacroKeywordDefinition;

/** The keywords of ajv-keywords that ajvKeywords() gives. */
export type AjvKeywordName =
  | 'typeof'
  | 'instanceof'
  | 'range'
  | 'exclusiveRange'
  | 'regexp'
  | 'uniqueItemProperties'
  | 'allRequired'
  | 'anyRequired'
  | 'oneRequired'
  | 'patternRequired'
  | 'prohibited'
  | 'deepProperties'
  | 'deepRequired';

/** Definitions of the keywords of ajv-keywords, for the option "keywords": all of them, or the ones named. */
export function ajvKeywords(names?: AjvKeywordName | readonly AjvKeywordName[]): KeywordDefinition[];

/**
 * Every built-in format for the option "formats" ({ date: true, ... }), to add formats of your own or known ones left
 * unchecked: formats: { ...builtInFormats(), int32: false }.
 */
export function builtInFormats(): { [name in FormatName]: true };

export interface KeywordTypeOptions extends TypeOptions {
  keyword?: string;
  check: (value: any) => boolean;
  message?: string | ((value: any) => string);
  jsonTypes?: readonly KeywordJsonType[];
}

/** A keyword of your own, as compileJsonSchema() converts it. */
export class KeywordType extends ValidateType<Present> {
  constructor(options: KeywordTypeOptions);
  keyword?: string;
  check: (value: any) => boolean;
  message?: string | ((value: any) => string);
  jsonTypes?: readonly KeywordJsonType[];
}

export class WhenType<Out = Present> extends ValidateType<Out> {
  constructor(options: WhenOptions);
  jsonType: WhenJsonType;
  type?: SchivaType;
}

export interface RefOptions extends TypeOptions {
  /** The type the reference stands for; it can be set later, for recursive schemas. */
  target?: ShapeValue;
  ref?: string;
}
export class RefType<Out = unknown> extends ValidateType<Out> {
  constructor(options?: RefOptions);
  target?: SchivaType;
  ref?: string;
  getTarget(): SchivaType;
}

export interface ObjOptions<S extends Shape = Shape> extends TypeOptions {
  schema?: S;
}
export class ObjType<Out = object> extends ValidateType<Out> {
  constructor(options?: ObjOptions);
  schema?: Shape;
}

// ---------------------------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------------------------

export interface SchemaOptions extends TypeOptions {
  /** Default true; false rejects the keys that are not declared (ClosedSchema). */
  isOpen?: boolean;
  /** The type of the keys that are not declared. */
  additionalType?: ShapeValue;
  /** The types of the keys that match a pattern. */
  patternTypes?: readonly { pattern: RegExp; type: ShapeValue }[];
  /** A type every key must satisfy. */
  propertyNameType?: ShapeValue;
  minProperties?: number;
  maxProperties?: number;
  /** When `key` is present, the `required` keys must be too, or the object must satisfy `type`. */
  dependencies?: readonly ({ key: string; required: readonly string[] } | { key: string; type: ShapeValue })[];
}

/** A schema for objects, with a type for each key. Plain objects inside it become nested schemas. */
export class Schema<S extends Shape = Shape, O extends SchemaOptions = {}> implements SchivaType<
  WithPresence<InferShape<S>, O>
> {
  readonly [OUTPUT]: WithPresence<InferShape<S>, O>;
  constructor(schema?: S, options?: O);
  schema: { [key: string]: SchivaType };
  options: O;
  isOpen: boolean;
  isMandatory: boolean;
  isNullable: boolean;
  keys: string[];
  isValid(value: unknown): value is WithPresence<InferShape<S>, O>;
  /** Checks without compiling: the error messages, [] when valid. */
  validate(value: unknown, fieldName?: string): string[];
  errors(value: unknown, fieldName?: string): string[];
  compile(options: CompileOptions & { errors: false }): IsValidFunction<WithPresence<InferShape<S>, O>>;
  compile(options: CompileOptions & { errors: 'objects' }): ErrorObjectsFunction;
  compile(options?: CompileOptions & { errors?: true }): ErrorsFunction;
  compile(options: CompileOptions): ErrorsFunction | ErrorObjectsFunction | IsValidFunction<WithPresence<InferShape<S>, O>>;
  mandatory(isMandatory?: true): Schema<S, Merge<O, { isMandatory: true }>>;
  mandatory(isMandatory: false): Schema<S, Merge<O, { isMandatory: false }>>;
  nullable(isNullable?: true): Schema<S, Merge<O, { isNullable: true }>>;
  nullable(isNullable: false): Schema<S, Merge<O, { isNullable: false }>>;
  optional(): Schema<S, Merge<O, { isMandatory: false }>>;
  required(): Schema<S, Merge<O, { isMandatory: true }>>;
  notNull(): Schema<S, Merge<O, { isNullable: false }>>;
}

/** A Schema that rejects the keys it does not declare. */
export class ClosedSchema<S extends Shape = Shape, O extends SchemaOptions = {}> extends Schema<S, O> {}

// ---------------------------------------------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------------------------------------------

export function String<O extends StringOptions = {}>(options?: O): StringType<WithPresence<string, O>>;
export function Integer<O extends NumberOptions = {}>(options?: O): IntegerType<WithPresence<number, O>>;
export function Float<O extends NumberOptions = {}>(options?: O): FloatType<WithPresence<number, O>>;
export function Boolean<O extends TypeOptions = {}>(options?: O): BooleanType<WithPresence<boolean, O>>;
export function Any<O extends TypeOptions = {}>(options?: O): AnyType<WithPresence<Present, O>>;
export function Never<O extends TypeOptions = {}>(options?: O): NeverType<WithPresence<never, O>>;
export function Enum<T extends string, O extends TypeOptions = {}>(
  options: O & { options: readonly T[] }
): EnumType<WithPresence<T, O>>;
export function Values<T extends Literal, O extends TypeOptions = {}>(
  options: O & { values: readonly T[] }
): ValuesType<WithPresence<T, O>>;
export function Const<T extends Literal, O extends TypeOptions = {}>(value: T, options?: O): ValuesType<WithPresence<T, O>>;
export function ArrayOf<
  T extends ArrayItems = never,
  A extends ShapeValue = never,
  O extends ArrayOfOptions = {},
>(options?: O & { type?: T; additionalType?: A }): ArrayOfType<WithPresence<InferItems<T, A>, O>>;
export function AllOf<T extends readonly ShapeValue[], O extends TypeOptions = {}>(
  options: O & { types: T }
): AllOfType<WithPresence<UnionToIntersection<Infer<T[number]>>, O>>;
export function AnyOf<T extends readonly ShapeValue[], O extends TypeOptions = {}>(
  options: O & { types: T }
): AnyOfType<WithPresence<Infer<T[number]>, O>>;
export function OneOf<T extends readonly ShapeValue[], O extends TypeOptions = {}>(
  options: O & { types: T }
): OneOfType<WithPresence<Infer<T[number]>, O>>;
export function Not<O extends NotOptions = {}>(options?: O): NotType<WithPresence<Present, O>>;
export function Conditional<T extends ShapeValue = never, E extends ShapeValue = never, O extends ConditionalOptions = {}>(
  options?: O & { thenType?: T; elseType?: E }
): ConditionalType<WithPresence<([T] extends [never] ? Present : Infer<T>) | ([E] extends [never] ? Present : Infer<E>), O>>;
export function When<O extends WhenOptions>(options: O): WhenType<WithPresence<Present, O>>;
/** A reference, for recursive schemas: give it the type of the values it stands for, `Ref<Node>()`. */
export function Ref<T = unknown, O extends RefOptions = {}>(options?: O): RefType<WithPresence<T, O>>;
export function Obj<S extends Shape = Shape, O extends TypeOptions = {}>(
  options?: O & { schema?: S }
): ObjType<WithPresence<InferShape<S>, O>>;

// Short helpers: (min, max, isMandatory, isNullable) or an options object; the ones prefixed with `o` are optional.

type Positional<M, N> = { isMandatory: M; isNullable: N };
type Optional<O> = Merge<{ isMandatory: false }, O>;

export function str<O extends StringOptions>(options: O): StringType<WithPresence<string, O>>;
export function str<M extends boolean = true, N extends boolean = false>(
  min?: number,
  max?: number,
  isMandatory?: M,
  isNullable?: N
): StringType<WithPresence<string, Positional<M, N>>>;
export function ostr<O extends StringOptions>(options: O): StringType<WithPresence<string, Optional<O>>>;
export function ostr<M extends boolean = false, N extends boolean = false>(
  min?: number,
  max?: number,
  isMandatory?: M,
  isNullable?: N
): StringType<WithPresence<string, Positional<M, N>>>;

export function int<O extends NumberOptions>(options: O): IntegerType<WithPresence<number, O>>;
export function int<M extends boolean = true, N extends boolean = false>(
  min?: number,
  max?: number,
  isMandatory?: M,
  isNullable?: N
): IntegerType<WithPresence<number, Positional<M, N>>>;
export function oint<O extends NumberOptions>(options: O): IntegerType<WithPresence<number, Optional<O>>>;
export function oint<M extends boolean = false, N extends boolean = false>(
  min?: number,
  max?: number,
  isMandatory?: M,
  isNullable?: N
): IntegerType<WithPresence<number, Positional<M, N>>>;

export function float<O extends NumberOptions>(options: O): FloatType<WithPresence<number, O>>;
export function float<M extends boolean = true, N extends boolean = false>(
  min?: number,
  max?: number,
  isMandatory?: M,
  isNullable?: N
): FloatType<WithPresence<number, Positional<M, N>>>;
export function ofloat<O extends NumberOptions>(options: O): FloatType<WithPresence<number, Optional<O>>>;
export function ofloat<M extends boolean = false, N extends boolean = false>(
  min?: number,
  max?: number,
  isMandatory?: M,
  isNullable?: N
): FloatType<WithPresence<number, Positional<M, N>>>;
export { float as num, ofloat as onum };

export function bool<O extends TypeOptions>(options: O): BooleanType<WithPresence<boolean, O>>;
export function bool<M extends boolean = true, N extends boolean = false>(
  isMandatory?: M,
  isNullable?: N
): BooleanType<WithPresence<boolean, Positional<M, N>>>;
export function obool<O extends TypeOptions>(options: O): BooleanType<WithPresence<boolean, Optional<O>>>;
export function obool<M extends boolean = false, N extends boolean = false>(
  isMandatory?: M,
  isNullable?: N
): BooleanType<WithPresence<boolean, Positional<M, N>>>;

export function any<O extends TypeOptions>(options: O): AnyType<WithPresence<Present, O>>;
export function any<M extends boolean = true, N extends boolean = false>(
  isMandatory?: M,
  isNullable?: N
): AnyType<WithPresence<Present, Positional<M, N>>>;
export function oany<O extends TypeOptions>(options: O): AnyType<WithPresence<Present, Optional<O>>>;
export function oany<M extends boolean = false, N extends boolean = false>(
  isMandatory?: M,
  isNullable?: N
): AnyType<WithPresence<Present, Positional<M, N>>>;

export function never<O extends TypeOptions>(options: O): NeverType<WithPresence<never, Optional<O>>>;
export function never<M extends boolean = false, N extends boolean = false>(
  isMandatory?: M,
  isNullable?: N
): NeverType<WithPresence<never, Positional<M, N>>>;

export function enumt<T extends string, O extends TypeOptions = {}>(
  options: O & { options: readonly T[] }
): EnumType<WithPresence<T, O>>;
export function enumt<T extends string, M extends boolean = true, N extends boolean = false>(
  options: readonly T[],
  isMandatory?: M,
  isNullable?: N
): EnumType<WithPresence<T, Positional<M, N>>>;
export function oenumt<T extends string, O extends TypeOptions = {}>(
  options: O & { options: readonly T[] }
): EnumType<WithPresence<T, Optional<O>>>;
export function oenumt<T extends string, M extends boolean = false, N extends boolean = false>(
  options: readonly T[],
  isMandatory?: M,
  isNullable?: N
): EnumType<WithPresence<T, Positional<M, N>>>;
export { oenumt as oenum };

export function arrOf<T extends ArrayItems = never, A extends ShapeValue = never, O extends ArrayOfOptions = {}>(
  options: O & { type?: T; additionalType?: A }
): ArrayOfType<WithPresence<InferItems<T, A>, O>>;
export function arrOf<T extends ArrayItems, M extends boolean = true, N extends boolean = false>(
  type?: T,
  min?: number,
  max?: number,
  isMandatory?: M,
  isNullable?: N
): ArrayOfType<WithPresence<InferItems<T, never>, Positional<M, N>>>;
export function oarrOf<T extends ArrayItems = never, A extends ShapeValue = never, O extends ArrayOfOptions = {}>(
  options: O & { type?: T; additionalType?: A }
): ArrayOfType<WithPresence<InferItems<T, A>, Optional<O>>>;
export function oarrOf<T extends ArrayItems, M extends boolean = false, N extends boolean = false>(
  type?: T,
  min?: number,
  max?: number,
  isMandatory?: M,
  isNullable?: N
): ArrayOfType<WithPresence<InferItems<T, never>, Positional<M, N>>>;

export function obj<S extends Shape, M extends boolean = true, N extends boolean = false>(
  schema: S,
  isMandatory?: M,
  isNullable?: N
): ObjType<WithPresence<InferShape<S>, Positional<M, N>>>;
export function oobj<S extends Shape, M extends boolean = false, N extends boolean = false>(
  schema: S,
  isMandatory?: M,
  isNullable?: N
): ObjType<WithPresence<InferShape<S>, Positional<M, N>>>;

export function allOf<T extends readonly ShapeValue[], M extends boolean = true, N extends boolean = false>(
  types: T,
  isMandatory?: M,
  isNullable?: N
): AllOfType<WithPresence<UnionToIntersection<Infer<T[number]>>, Positional<M, N>>>;
export function oallOf<T extends readonly ShapeValue[], M extends boolean = false, N extends boolean = false>(
  types: T,
  isMandatory?: M,
  isNullable?: N
): AllOfType<WithPresence<UnionToIntersection<Infer<T[number]>>, Positional<M, N>>>;
export function anyOf<T extends readonly ShapeValue[], M extends boolean = true, N extends boolean = false>(
  types: T,
  isMandatory?: M,
  isNullable?: N
): AnyOfType<WithPresence<Infer<T[number]>, Positional<M, N>>>;
export function oanyOf<T extends readonly ShapeValue[], M extends boolean = false, N extends boolean = false>(
  types: T,
  isMandatory?: M,
  isNullable?: N
): AnyOfType<WithPresence<Infer<T[number]>, Positional<M, N>>>;
export function oneOf<T extends readonly ShapeValue[], M extends boolean = true, N extends boolean = false>(
  types: T,
  isMandatory?: M,
  isNullable?: N
): OneOfType<WithPresence<Infer<T[number]>, Positional<M, N>>>;
export function ooneOf<T extends readonly ShapeValue[], M extends boolean = false, N extends boolean = false>(
  types: T,
  isMandatory?: M,
  isNullable?: N
): OneOfType<WithPresence<Infer<T[number]>, Positional<M, N>>>;
export function not<M extends boolean = true, N extends boolean = false>(
  type: ShapeValue,
  isMandatory?: M,
  isNullable?: N
): NotType<WithPresence<Present, Positional<M, N>>>;
export function onot<M extends boolean = false, N extends boolean = false>(
  type: ShapeValue,
  isMandatory?: M,
  isNullable?: N
): NotType<WithPresence<Present, Positional<M, N>>>;

// ---------------------------------------------------------------------------------------------------------------
// Compiling and JSON Schema
// ---------------------------------------------------------------------------------------------------------------

/** A function returning every error message of a value, [] when valid. */
export function compileErrors(type: ShapeValue): ErrorsFunction;
/** A function returning the first error message of a value, undefined when valid. */
export function compileFirstError(type: ShapeValue): (value: unknown) => string | undefined;
/** A function telling whether a value is valid, as a type guard. */
export function compileIsValid<T extends ShapeValue>(type: T): IsValidFunction<Infer<T>>;
export function compileType<T extends ShapeValue>(type: T, options: CompileOptions & { errors: false }): IsValidFunction<Infer<T>>;
export function compileType(type: ShapeValue, options: CompileOptions & { errors: 'objects' }): ErrorObjectsFunction;
export function compileType(type: ShapeValue, options?: CompileOptions & { errors?: true }): ErrorsFunction;
export function compileType<T extends ShapeValue>(
  type: T,
  options: CompileOptions
): ErrorsFunction | ErrorObjectsFunction | IsValidFunction<Infer<T>>;

/** A JSON Schema: an object of keywords, or true (any value) or false (no value). */
/** A JSON Schema object (not a boolean schema). */
export type JsonSchemaObject = { [keyword: string]: unknown };
export type JsonSchema = boolean | JsonSchemaObject;

/** JSON Schema drafts, for the `draft` option. */
export type JsonSchemaDraft = 'draft-04' | 'draft-06' | 'draft-07' | '2019-09' | '2020-12';

export interface JsonSchemaOptions {
  /**
   * Other documents that "$ref" can point to: { uri: schema }, or schemas with "$id". Relative URIs ("address") are
   * reached from schemas without "$id" ("$ref": "address#"), as in ajv and Fastify.
   */
  schemas?: { [uri: string]: JsonSchema } | readonly JsonSchema[];
  /** The draft; by default the one "$schema" names, else draft-07. */
  draft?: JsonSchemaDraft;
  /**
   * The formats "format" checks, which is an annotation without this option: true for every built-in one, a list of
   * built-in ones, or an object with, for each name, true (a built-in one), a check of your own, or false (known but
   * not checked). With this option and strict: true, a format it does not name throws.
   */
  formats?: boolean | readonly FormatName[] | { [name: string]: true | false | FormatCheck | FormatDefinition };
  /**
   * true (default): an unknown keyword throws. false: unknown keywords, the keywords of other drafts and the ones a
   * "type" excludes are ignored, as the JSON Schema standard reads them.
   */
  strict?: boolean;
  /**
   * Keywords of your own: names of annotations (they check nothing), such as "x-internal" or "example", and
   * definitions of keywords that check values (see KeywordDefinition, and ajvKeywords()).
   */
  keywords?: readonly (string | KeywordDefinition)[];
  /**
   * Changes the data (off by default): true assigns the "default" of missing properties and tuple elements before
   * checking them, 'empty' also the one of null and ''. Defaults inside anyOf, oneOf, not and if throw (ignored with
   * strict: false).
   */
  useDefaults?: boolean | 'empty';
  /**
   * Changes the data (off by default): true removes the additional properties where additionalProperties is false,
   * 'all' every additional property of a schema with properties or additionalProperties, and 'failing' also the ones
   * that fail additionalProperties.
   */
  removeAdditional?: boolean | 'all' | 'failing';
  /**
   * Changes the data (off by default): true converts a value to the types its schema's "type" asks for, with ajv's
   * rules ('1' to 1, 'true' to true, 1 to '1', '' to null...), writing it back into its object or array; 'array' also
   * wraps values into arrays and takes the element of an array of one.
   */
  coerceTypes?: boolean | 'array';
  /** Decimal digits: multipleOf accepts a division within 1e-multipleOfPrecision of an integer, as in ajv. */
  multipleOfPrecision?: number;
}

/** The option of compileJsonSchemaAsync() and loadJsonSchemas(): gives the schema at an absolute URI. */
export interface LoadSchemaOptions {
  loadSchema: (uri: string) => Promise<JsonSchema> | JsonSchema;
}

/**
 * Compiles a JSON Schema. The values it accepts are `unknown` to TypeScript; give their type to get a type guard
 * with errors: false: compileJsonSchema<User>(schema, { errors: false }).
 */
export function compileJsonSchema<T = unknown>(
  json: JsonSchema,
  options: JsonSchemaOptions & CompileOptions & { errors: false }
): IsValidFunction<T>;
export function compileJsonSchema(
  json: JsonSchema,
  options: JsonSchemaOptions & CompileOptions & { errors: 'objects' }
): ErrorObjectsFunction;
export function compileJsonSchema(
  json: JsonSchema,
  options?: JsonSchemaOptions & CompileOptions & { errors?: true }
): ErrorsFunction;
export function compileJsonSchema<T = unknown>(
  json: JsonSchema,
  options: JsonSchemaOptions & CompileOptions
): ErrorsFunction | ErrorObjectsFunction | IsValidFunction<T>;

/**
 * compileJsonSchema() for a schema that references documents to load first with loadSchema (like ajv's
 * compileAsync()). Only the documents the schema reaches are loaded, once each.
 */
export function compileJsonSchemaAsync<T = unknown>(
  json: JsonSchema,
  options: LoadSchemaOptions & JsonSchemaOptions & CompileOptions & { errors: false }
): Promise<IsValidFunction<T>>;
export function compileJsonSchemaAsync(
  json: JsonSchema,
  options: LoadSchemaOptions & JsonSchemaOptions & CompileOptions & { errors: 'objects' }
): Promise<ErrorObjectsFunction>;
export function compileJsonSchemaAsync(
  json: JsonSchema,
  options: LoadSchemaOptions & JsonSchemaOptions & CompileOptions & { errors?: true }
): Promise<ErrorsFunction>;
export function compileJsonSchemaAsync<T = unknown>(
  json: JsonSchema,
  options: LoadSchemaOptions & JsonSchemaOptions & CompileOptions
): Promise<ErrorsFunction | ErrorObjectsFunction | IsValidFunction<T>>;

/**
 * Loads the documents a schema references that options.schemas does not have, with loadSchema. Resolves to
 * options.schemas with them added, as { uri: schema }, for compileJsonSchema() or standaloneJsonSchema().
 */
export function loadJsonSchemas(
  json: JsonSchema,
  options: LoadSchemaOptions & JsonSchemaOptions
): Promise<{ [uri: string]: JsonSchema }>;

/** Converts a JSON Schema into schiva types. */
export function fromJsonSchema<T = unknown>(json: JsonSchema, options?: JsonSchemaOptions): SchivaType<T>;

// ---------------------------------------------------------------------------------------------------------------
// Standalone code
// ---------------------------------------------------------------------------------------------------------------

/** Options of standaloneCode(), standaloneModule() and standaloneJsonSchema(). */
export interface StandaloneOptions extends CompileOptions {
  /** The module format of the code: 'commonjs' (default) or 'esm'. */
  format?: 'commonjs' | 'esm';
}

/**
 * The source of a module whose default export (module.exports in CommonJS) is the function compile(options) returns.
 * Save it to a file when building: loading it generates no code, so it runs under a strict Content Security Policy.
 * Types of your own cannot be written out, and throw.
 */
export function standaloneCode(type: ShapeValue, options?: StandaloneOptions): string;

/** The source of a module exporting a validation function for each entry, by its name. */
export function standaloneModule(validators: { [name: string]: ShapeValue }, options?: StandaloneOptions): string;

/** standaloneCode() for a JSON Schema, with the options of compileJsonSchema() too. */
export function standaloneJsonSchema(json: JsonSchema, options?: JsonSchemaOptions & StandaloneOptions): string;

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

/** Whether a validate() result holds an error. */
export function hasErrors(result: ValidationResult): boolean;
/** The messages of a validate() result as a flat list, each one once. */
export function toErrors(result: ValidationResult): string[];
/** Whether a value is of a JSON type, as When checks it. */
export function isJsonType(value: unknown, jsonType: WhenJsonType): boolean;
