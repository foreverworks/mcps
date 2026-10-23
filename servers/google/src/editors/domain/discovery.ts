/**
 * Google's Discovery format (the API's own description of its wire shapes)
 * and the two things this server does with it: check a batchUpdate's requests
 * before they are sent, and answer a model that asks what a request takes.
 * Pure. Docs, Sheets and Slides vendor theirs (`src/<product>/domain/discovery.json`,
 * refreshed by scripts/refresh-discovery.ts), so a request is checked against
 * the revision this server was built with, and a problem names that revision.
 */

export type Property = {
  readonly type?: string;
  readonly $ref?: string;
  readonly items?: Property;
  readonly additionalProperties?: Property;
  readonly enum?: readonly string[];
  readonly enumDescriptions?: readonly string[];
  readonly format?: string;
  readonly description?: string;
  readonly readOnly?: boolean;
  readonly deprecated?: boolean;
};

export type Schema = Property & { readonly id?: string; readonly properties?: Readonly<Record<string, Property>> };

export type Discovery = {
  readonly name: string;
  readonly version: string;
  readonly revision: string;
  readonly schemas: Readonly<Record<string, Schema>>;
};

/** One request as a model sends it: `{ "<kind>": { ...its fields } }`. */
export type ApiRequest = Readonly<Record<string, unknown>>;

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const typeOf = (value: unknown): string => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);

/** The schema a property points to, when it is a reference. */
const target = (d: Discovery, property: Property): Schema | undefined => (property.$ref ? d.schemas[property.$ref] : undefined);

/** The request kinds this API's batchUpdate takes, each with the schema of its body. */
export const requestKinds = (d: Discovery): Readonly<Record<string, Property>> => d.schemas.Request?.properties ?? {};

const distance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] as number;
      row[j] = Math.min(above + 1, (row[j - 1] as number) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length] as number;
};

/** "; did you mean X?" for the closest known name, when one is close; else the names there are, when few. */
export const suggestion = (wanted: string, known: readonly string[]): string => {
  const lower = wanted.toLowerCase();
  const close = known
    .map((name) => ({ name, d: name.toLowerCase() === lower ? 0 : distance(lower, name.toLowerCase()) }))
    .filter((c) => c.d <= Math.max(2, Math.floor(wanted.length / 4)))
    .sort((a, b) => a.d - b.d)[0];
  if (close) return `; did you mean ${close.name}?`;
  return known.length <= 12 ? `; it takes ${known.join(", ")}` : "";
};

/**
 * A field mask Google requires: every update request's `fields`, whose
 * description says at least one field must be named. The one in
 * UpdateEmbeddedObjectPosition ("used only if ...") is optional, and its
 * description says so, which is why this reads the words.
 */
const maskRequired = (property: Property): boolean =>
  property.format === "google-fieldmask" &&
  /at least .{1,40} must be specified|^required\./i.test(property.description ?? "") &&
  !/used only if/i.test(property.description ?? "");

const MAX_PROBLEMS = 25;

type Walk = { readonly d: Discovery; readonly out: string[] };

const checkValue = (walk: Walk, property: Property, value: unknown, path: string): void => {
  if (walk.out.length >= MAX_PROBLEMS) return;
  // proto3 JSON reads null as "not set", in every field.
  if (value === null || value === undefined) return;
  const schema = target(walk.d, property);
  if (property.$ref && !schema) return void walk.out.push(`${path}: the schema names a type it does not define (${property.$ref})`);
  if (schema) return checkObject(walk, schema, value, path);
  if (property.enum && !(typeof value === "string" && property.enum.includes(value))) {
    return void walk.out.push(`${path}: ${JSON.stringify(value)} is not one of ${property.enum.join(", ")}`);
  }
  switch (property.type) {
    case "string":
      if (typeof value !== "string") walk.out.push(`${path}: expected a string, got ${typeOf(value)}`);
      return;
    case "boolean":
      if (typeof value !== "boolean") walk.out.push(`${path}: expected true or false, got ${typeOf(value)}`);
      return;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) walk.out.push(`${path}: expected an integer, got ${JSON.stringify(value)}`);
      else if (property.format === "uint32" && value < 0) walk.out.push(`${path}: expected an integer of at least 0, got ${value}`);
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) walk.out.push(`${path}: expected a number, got ${typeOf(value)}`);
      return;
    case "array":
      if (!Array.isArray(value)) return void walk.out.push(`${path}: expected an array, got ${typeOf(value)}`);
      if (property.items) value.forEach((item, n) => checkValue(walk, property.items as Property, item, `${path}[${n}]`));
      return;
    case "object":
      if (!isObject(value)) return void walk.out.push(`${path}: expected an object, got ${typeOf(value)}`);
      if (property.additionalProperties) {
        for (const [key, item] of Object.entries(value)) checkValue(walk, property.additionalProperties, item, `${path}.${key}`);
      }
      return;
    default:
      return;
  }
};

const checkObject = (walk: Walk, schema: Schema, value: unknown, path: string): void => {
  if (!isObject(value)) return void walk.out.push(`${path}: expected an object (${schema.id ?? "object"}), got ${typeOf(value)}`);
  const properties = schema.properties ?? {};
  for (const [key, item] of Object.entries(value)) {
    const property = properties[key];
    if (!property) {
      if (schema.additionalProperties) checkValue(walk, schema.additionalProperties, item, `${path}.${key}`);
      else walk.out.push(`${path}.${key}: ${schema.id ?? "this object"} has no field "${key}"${suggestion(key, Object.keys(properties))}`);
      continue;
    }
    if (property.readOnly && item !== null && item !== undefined) {
      walk.out.push(`${path}.${key}: read-only, set by Google; leave it out`);
      continue;
    }
    checkValue(walk, property, item, `${path}.${key}`);
  }
};

/**
 * Every way a list of requests disagrees with the API's schema, as
 * "path: what is wrong" lines (at most 25). Empty means Google will at least
 * parse them; whether they make sense against the file is Google's to say.
 *
 * Checked: one kind per request, known kinds and fields (with the nearest name
 * when one is misspelt), types, enum values, integers, read-only fields, and
 * the field mask every update request requires.
 */
export const checkRequests = (d: Discovery, requests: readonly unknown[]): readonly string[] => {
  const walk: Walk = { d, out: [] };
  const kinds = requestKinds(d);
  const names = Object.keys(kinds);
  requests.forEach((request, n) => {
    const at = `requests[${n}]`;
    if (!isObject(request)) return void walk.out.push(`${at}: expected an object holding one request, e.g. {"${names[0] ?? "kind"}": {...}}`);
    const keys = Object.keys(request);
    if (keys.length !== 1) walk.out.push(`${at}: one request kind per entry, got ${keys.length === 0 ? "none" : keys.join(" and ")}`);
    for (const kind of keys) {
      const property = kinds[kind];
      if (!property) {
        walk.out.push(`${at}.${kind}: not a ${d.name} request kind${suggestion(kind, names)}`);
        continue;
      }
      const body = request[kind];
      checkValue(walk, property, body, `${at}.${kind}`);
      const schema = target(d, property);
      if (!isObject(body) || !schema) continue;
      for (const [field, spec] of Object.entries(schema.properties ?? {})) {
        if (maskRequired(spec) && (body[field] === undefined || body[field] === "")) {
          walk.out.push(`${at}.${kind}.${field}: required: the comma-separated names of the fields being set (e.g. "bold,fontSize"), or "*" for all`);
        }
      }
    }
  });
  return walk.out.slice(0, MAX_PROBLEMS);
};

/**
 * Values of one type (a Sheets DataFilter, say) checked the way a request's
 * fields are, as "path: what is wrong" lines.
 */
export const checkTyped = (d: Discovery, type: string, values: readonly unknown[], path: string): readonly string[] => {
  const walk: Walk = { d, out: [] };
  if (!d.schemas[type]) return [`${path}: ${d.name} has no type ${type}`];
  values.forEach((value, n) => checkValue(walk, { $ref: type }, value, `${path}[${n}]`));
  return walk.out.slice(0, MAX_PROBLEMS);
};

/**
 * Rewrite the values of chosen types wherever the schema puts one, leaving the
 * rest as given: how Sheets takes an A1 string where a GridRange goes. The
 * visitor answers the replacement, or undefined to leave the value alone.
 * Walks the same shapes checkRequests does, so a value it reaches is one the
 * check would read as that type.
 */
export const rewriteTyped = (
  d: Discovery,
  requests: readonly ApiRequest[],
  visit: (type: string, value: unknown, path: string) => unknown,
): readonly ApiRequest[] => {
  const kinds = requestKinds(d);
  const walkValue = (property: Property, value: unknown, path: string, depth: number): unknown => {
    if (value === null || value === undefined || depth > 40) return value;
    if (property.$ref) {
      const replaced = visit(property.$ref, value, path);
      if (replaced !== undefined) return replaced;
      const schema = d.schemas[property.$ref];
      if (!schema || !isObject(value)) return value;
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          const inner = schema.properties?.[key] ?? schema.additionalProperties;
          return [key, inner ? walkValue(inner, item, `${path}.${key}`, depth + 1) : item];
        }),
      );
    }
    if (property.type === "array" && property.items && Array.isArray(value)) {
      return value.map((item, n) => walkValue(property.items as Property, item, `${path}[${n}]`, depth + 1));
    }
    if (property.type === "object" && property.additionalProperties && isObject(value)) {
      const inner = property.additionalProperties;
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walkValue(inner, item, `${path}.${key}`, depth + 1)]));
    }
    return value;
  };
  return requests.map((request, n) =>
    Object.fromEntries(
      Object.entries(request).map(([kind, body]) => {
        const property = kinds[kind];
        return [kind, property ? walkValue(property, body, `requests[${n}].${kind}`, 0) : body];
      }),
    ),
  );
};

// ---------------------------------------------------------------------------
// The reference: what a request or a type takes, for a model to read.

const DESCRIPTION_MAX = 700;

/** A description cut at a sentence end near the limit, so a long one stays readable. */
const shorten = (text: string | undefined, max = DESCRIPTION_MAX): string | undefined => {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const end = cut.lastIndexOf(". ");
  return `${end > max / 2 ? cut.slice(0, end + 1) : cut} …`;
};

/** The first sentence: a request kind's one-line summary. */
const firstSentence = (text: string | undefined): string => {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  const end = flat.search(/\.(\s|$)/);
  return end === -1 ? flat : flat.slice(0, end + 1);
};

const typeText = (property: Property): string => {
  if (property.$ref) return property.$ref;
  if (property.enum) return "enum";
  switch (property.type) {
    case "array":
      return `array of ${property.items ? typeText(property.items) : "any"}`;
    case "object":
      return property.additionalProperties ? `map of string to ${typeText(property.additionalProperties)}` : "object";
    case "string":
      if (property.format === "google-fieldmask") return "string (field mask)";
      if (property.format === "google-datetime") return "string (RFC 3339 time)";
      if (property.format === "byte") return "string (base64)";
      return property.format === "int64" ? "string (64-bit integer)" : "string";
    case "integer":
    case "number":
      return property.format ? `${property.type} (${property.format})` : property.type;
    default:
      return property.type ?? "any";
  }
};

export type FieldDoc = {
  readonly type: string;
  readonly description?: string;
  /** Each allowed value and what it means. */
  readonly values?: Readonly<Record<string, string>>;
  readonly readOnly?: true;
  readonly deprecated?: true;
};

const fieldDoc = (property: Property): FieldDoc => {
  const description = shorten(property.description);
  const values = property.enum ?? property.items?.enum;
  const meanings = property.enum ? property.enumDescriptions : property.items?.enumDescriptions;
  return {
    type: typeText(property),
    ...(description ? { description } : {}),
    ...(values ? { values: Object.fromEntries(values.map((v, i) => [v, shorten(meanings?.[i], 200) ?? ""])) } : {}),
    ...(property.readOnly ? { readOnly: true as const } : {}),
    ...(property.deprecated ? { deprecated: true as const } : {}),
  };
};

export type TypeDoc = { readonly description?: string; readonly fields: Readonly<Record<string, FieldDoc>> };

const typeDoc = (schema: Schema): TypeDoc => {
  const description = shorten(schema.description);
  return {
    ...(description ? { description } : {}),
    fields: Object.fromEntries(Object.entries(schema.properties ?? {}).map(([name, property]) => [name, fieldDoc(property)])),
  };
};

/** The types a schema's fields refer to, directly. */
const refsOf = (schema: Schema): readonly string[] =>
  [...new Set(Object.values(schema.properties ?? {}).flatMap((p) => [p.$ref, p.items?.$ref, p.additionalProperties?.$ref].filter((r): r is string => !!r)))];

export type Reference =
  | { readonly api: string; readonly revision: string; readonly requests: Readonly<Record<string, string>>; readonly next: string }
  | {
      readonly api: string;
      readonly revision: string;
      readonly name: string;
      /** The request kind this type is the body of, when it is one. */
      readonly request?: string;
      readonly description?: string;
      readonly fields: Readonly<Record<string, FieldDoc>>;
      /** The types the fields refer to, `depth` levels down. */
      readonly types: Readonly<Record<string, TypeDoc>>;
      /** Types referred to beyond the depth or the cap: ask for them by name. */
      readonly more?: readonly string[];
    };

const MAX_TYPES = 30;

/**
 * What a request kind (`updateTextStyle`) or a type (`TextStyle`) takes, with
 * the types it refers to expanded `depth` levels down; with no name, every
 * request kind and its one-line summary.
 */
export const reference = (d: Discovery, name: string, depth: number): Reference | { readonly unknown: string } => {
  const kinds = requestKinds(d);
  const wanted = name.trim();
  if (wanted === "") {
    return {
      api: d.name,
      revision: d.revision,
      requests: Object.fromEntries(Object.entries(kinds).map(([kind, p]) => [kind, firstSentence(target(d, p)?.description ?? p.description)])),
      next: "Call again with name set to a request kind (or any type it mentions) to see its fields.",
    };
  }
  const kind = kinds[wanted] ? wanted : Object.keys(kinds).find((k) => k.toLowerCase() === wanted.toLowerCase());
  const id =
    (kind ? kinds[kind]?.$ref : undefined) ?? (d.schemas[wanted] ? wanted : Object.keys(d.schemas).find((s) => s.toLowerCase() === wanted.toLowerCase()));
  const schema = id ? d.schemas[id] : undefined;
  if (!id || !schema) {
    return { unknown: `no request kind or type "${wanted}" in ${d.name} ${d.version} (revision ${d.revision})${suggestion(wanted, [...Object.keys(kinds), ...Object.keys(d.schemas)])}` };
  }
  const requestOf = kind ?? Object.entries(kinds).find(([, p]) => p.$ref === id)?.[0];
  const types: Record<string, TypeDoc> = {};
  const more = new Set<string>();
  let frontier = refsOf(schema);
  for (let level = 0; level < depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const ref of frontier) {
      if (ref === id || types[ref]) continue;
      const inner = d.schemas[ref];
      if (!inner) continue;
      if (Object.keys(types).length >= MAX_TYPES) {
        more.add(ref);
        continue;
      }
      types[ref] = typeDoc(inner);
      next.push(...refsOf(inner));
    }
    frontier = next;
  }
  for (const ref of frontier) if (ref !== id && !types[ref]) more.add(ref);
  const doc = typeDoc(schema);
  return {
    api: d.name,
    revision: d.revision,
    name: id,
    ...(requestOf ? { request: requestOf } : {}),
    ...doc,
    types,
    ...(more.size > 0 ? { more: [...more].sort() } : {}),
  };
};
