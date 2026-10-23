/**
 * A domain's records as a BIND zone file (RFC 1035 section 5), both ways:
 * written from what Porkbun lists, and read into the records Porkbun's
 * import takes. Pure text work; nothing here asks DNS anything.
 *
 * Porkbun keeps a record as a full name, a type, a `content` string and a
 * separate `prio` for MX and SRV. Its content is the record's presentation
 * form with host names written without the final dot and an SRV's priority
 * moved out (`weight port target`); a TXT record's content is the text
 * itself, unquoted.
 */

/** A record as list_dns_records answers: the full name, and ttl and prio as Porkbun sends them (strings). */
export type ListedRecord = {
  readonly name: string;
  readonly type: string;
  readonly content: string;
  readonly ttl?: string | number | null | undefined;
  readonly prio?: string | number | null | undefined;
  readonly notes?: string | null | undefined;
};

/** A record as Porkbun's import takes it: `name` relative to the domain, "" for the apex. */
export type ImportRecord = { readonly name: string; readonly type: string; readonly content: string; readonly ttl?: number; readonly prio?: number };

/** A record in the file that is not imported, and why. */
export type Ignored = { readonly line: number; readonly name: string; readonly type: string; readonly why: string };

export type ParsedZone = { readonly ok: true; readonly records: readonly ImportRecord[]; readonly ignored: readonly Ignored[] } | { readonly ok: false; readonly problems: readonly string[] };

/** The types Porkbun's DNS holds (the vendor's DNS_RECORD_TYPES). */
const HOST_TARGET = new Set(["CNAME", "ALIAS", "NS"]);
const AS_WRITTEN = new Set(["CAA", "TLSA", "SSHFP", "HTTPS", "SVCB"]);
export const IMPORTABLE = ["A", "AAAA", "CNAME", "ALIAS", "MX", "TXT", "SRV", ...AS_WRITTEN] as const;

/** Types a zone file may carry that are not the zone's to import, each with the reason given back. */
const NOT_IMPORTED: Readonly<Record<string, string>> = {
  SOA: "Porkbun answers with its own SOA",
  NS: "Porkbun's import ignores NS records: the domain's delegation is update_nameservers, a subdomain's is create_dns_record",
  SPF: "the SPF record type is obsolete (RFC 7208); the TXT record carries the policy",
  DNSKEY: "DNSSEC signing data belongs to whoever signs the zone",
  RRSIG: "DNSSEC signing data belongs to whoever signs the zone",
  NSEC: "DNSSEC signing data belongs to whoever signs the zone",
  NSEC3: "DNSSEC signing data belongs to whoever signs the zone",
  NSEC3PARAM: "DNSSEC signing data belongs to whoever signs the zone",
  CDS: "DNSSEC signing data belongs to whoever signs the zone",
  CDNSKEY: "DNSSEC signing data belongs to whoever signs the zone",
};

// ─── Writing ────────────────────────────────────────────────────────────────

const lower = (name: string): string => name.trim().replace(/\.$/, "").toLowerCase();

/** A host name as a zone file writes it, absolute. */
const dotted = (host: string): string => (host === "" || host === "." ? "." : host.endsWith(".") ? host : `${host}.`);

/** The owner as the file writes it under `$ORIGIN <domain>.`: `@`, a relative name, or an absolute one outside the domain. */
const ownerOf = (name: string, domain: string): string => {
  const full = lower(name);
  if (full === domain || full === "") return "@";
  return full.endsWith(`.${domain}`) ? full.slice(0, -domain.length - 1) : `${full}.`;
};

const wholeNumber = (value: string | number | null | undefined): number | undefined => {
  const text = typeof value === "number" ? String(value) : (value ?? "").trim();
  return /^\d{1,10}$/.test(text) ? Number(text) : undefined;
};

/** TXT text as quoted strings of at most 255 bytes, `"` and `\` escaped and every byte outside printable ASCII as \DDD. */
const quotedTxt = (text: string): string => {
  const bytes = Buffer.from(text, "utf8");
  const chunks: string[] = [];
  for (let at = 0; at < bytes.length || chunks.length === 0; at += 255) {
    const chunk = [...bytes.subarray(at, at + 255)]
      .map((b) => (b === 0x22 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\${String(b).padStart(3, "0")}`))
      .join("");
    chunks.push(`"${chunk}"`);
  }
  return chunks.join(" ");
};

const rdataOf = (record: ListedRecord): string => {
  const type = record.type.toUpperCase();
  const prio = wholeNumber(record.prio) ?? 0;
  if (type === "TXT") return quotedTxt(record.content);
  if (HOST_TARGET.has(type)) return dotted(record.content.trim());
  if (type === "MX") return `${String(prio)} ${dotted(record.content.trim())}`;
  if (type === "SRV") {
    const parts = record.content.trim().split(/\s+/);
    return parts.length === 3 ? `${String(prio)} ${parts[0] as string} ${parts[1] as string} ${dotted(parts[2] as string)}` : `${String(prio)} ${record.content.trim()}`;
  }
  return record.content.trim();
};

/** A record's notes as a comment after it, on the same line. */
const noteOf = (notes: string | null | undefined): string => {
  const text = (notes ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? "" : ` ; ${text}`;
};

/** The zone file for these records, with how many of each type it holds. */
export const zoneText = (domainName: string, records: readonly ListedRecord[]): { readonly text: string; readonly types: Readonly<Record<string, number>> } => {
  const domain = lower(domainName);
  const types: Record<string, number> = {};
  const lines = records.map((record) => {
    const type = record.type.toUpperCase();
    types[type] = (types[type] ?? 0) + 1;
    const ttl = wholeNumber(record.ttl);
    return [ownerOf(record.name, domain), ttl === undefined ? "" : String(ttl), "IN", type, rdataOf(record)].filter((f) => f !== "").join("\t") + noteOf(record.notes);
  });
  const untimed = records.some((record) => wholeNumber(record.ttl) === undefined);
  const head = [
    `; ${domain}: ${String(records.length)} record${records.length === 1 ? "" : "s"}, as Porkbun's DNS holds them (list_dns_records).`,
    "; Porkbun answers with its own SOA, so the file has none; a record's notes follow it as a comment.",
    `$ORIGIN ${domain}.`,
    ...(untimed ? ["$TTL 600 ; Porkbun's usual minimum, for a record listed without a TTL"] : []),
  ];
  return { text: `${[...head, ...lines].join("\n")}\n`, types };
};

// ─── Reading ────────────────────────────────────────────────────────────────

type Token = { readonly raw: string; readonly quoted: boolean };
type Entry = { readonly line: number; readonly inherits: boolean; readonly tokens: readonly Token[] };

/**
 * The file as entries: one per record or directive, its tokens with quotes
 * and escapes kept raw, comments dropped, parentheses joining lines.
 * `inherits` is an entry whose line starts with blank space: it has no owner
 * of its own and takes the previous one.
 */
const entriesOf = (text: string): { readonly entries: readonly Entry[]; readonly problems: readonly string[] } => {
  const entries: Entry[] = [];
  const problems: string[] = [];
  let tokens: Token[] = [];
  let line = 1;
  let start = 1;
  let inherits = false;
  let blankStart = false;
  let atLineStart = true;
  let depth = 0;
  let openedAt = 0;
  const push = (token: Token) => {
    if (tokens.length === 0) {
      start = line;
      inherits = blankStart;
    }
    tokens.push(token);
  };
  const flush = () => {
    if (tokens.length > 0) entries.push({ line: start, inherits, tokens });
    tokens = [];
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (atLineStart && depth === 0) blankStart = c === " " || c === "\t";
    atLineStart = false;
    if (c === "\n") {
      line += 1;
      i += 1;
      atLineStart = true;
      if (depth === 0) flush();
    } else if (c === "\r" || c === " " || c === "\t") {
      i += 1;
    } else if (c === ";") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (c === "(") {
      if (depth === 0) openedAt = line;
      depth += 1;
      i += 1;
    } else if (c === ")") {
      if (depth === 0) problems.push(`line ${String(line)}: a ")" with no "(" before it`);
      depth = Math.max(0, depth - 1);
      i += 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (j >= text.length) {
        problems.push(`line ${String(line)}: a quoted string that never closes`);
        tokens = [];
        break;
      }
      push({ raw: text.slice(i + 1, j), quoted: true });
      line += (text.slice(i, j).match(/\n/g) ?? []).length;
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !/[\s;()"]/.test(text[j] as string)) j += text[j] === "\\" ? 2 : 1;
      push({ raw: text.slice(i, j), quoted: false });
      i = j;
    }
  }
  if (depth > 0) problems.push(`line ${String(openedAt)}: a "(" that never closes`);
  flush();
  return { entries, problems };
};

/** A token's bytes, its escapes resolved: \DDD is that byte, \X is X. */
const bytesOf = (raw: string): Buffer => {
  const out: Buffer[] = [];
  for (let i = 0; i < raw.length; ) {
    const digits = raw[i] === "\\" ? /^\d{3}/.exec(raw.slice(i + 1)) : null;
    if (digits !== null) {
      out.push(Buffer.from([Number(digits[0]) & 0xff]));
      i += 4;
    } else {
      const at = raw[i] === "\\" ? i + 1 : i;
      const char = String.fromCodePoint(raw.codePointAt(at) ?? 0x3f);
      out.push(Buffer.from(char, "utf8"));
      i = at + char.length;
    }
  }
  return Buffer.concat(out);
};

/**
 * BIND's TTL: seconds, or a sum of units (1h30m, 2d, 1w). The test reads
 * digits, then any number of unit-and-digits, then an optional last unit:
 * one way to read any token, so it takes time in proportion to its length.
 * (`(\d+[smhdw]?)+` read a run of digits in every way it can be cut, and a
 * field of 30 zeros and a letter took seconds.)
 */
const ttlOf = (token: Token | undefined): number | undefined => {
  if (token === undefined || token.quoted || !/^\d+(?:[smhdw]\d+)*[smhdw]?$/i.test(token.raw)) return undefined;
  const unit: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  const parts = [...token.raw.toLowerCase().matchAll(/(\d+)([smhdw]?)/g)];
  return parts.reduce((total, [, n, u]) => total + Number(n) * (unit[u || "s"] as number), 0);
};

const CLASSES = new Set(["IN", "CH", "HS", "CS"]);

/** A name in the file made absolute (lower case, no final dot): `@` is the origin, a name without a final dot is under it. */
const absolute = (raw: string, origin: string): string => (raw === "@" ? origin : raw.endsWith(".") ? lower(raw) : lower(`${raw}.${origin}`));

/** A host an MX, CNAME, SRV or ALIAS points at, as Porkbun keeps it: absolute, without the final dot, case kept. */
const target = (raw: string, origin: string): string => (raw === "@" ? origin : raw === "." ? "." : raw.endsWith(".") ? raw.slice(0, -1) : `${raw}.${origin}`);

/** A 16-bit field (an MX preference, an SRV priority, weight or port). */
const integer = (token: Token | undefined): number | undefined =>
  token !== undefined && !token.quoted && /^\d{1,5}$/.test(token.raw) && Number(token.raw) <= 65535 ? Number(token.raw) : undefined;

/** The rdata as written, quoted strings quoted again, for the types Porkbun keeps in presentation form. */
const written = (tokens: readonly Token[]): string => tokens.map((t) => (t.quoted ? `"${t.raw}"` : t.raw)).join(" ");

/**
 * The records of a zone file for `domainName`, as Porkbun's import takes
 * them, with what is deliberately not imported (SOA, NS, DNSSEC data); or
 * every problem found, each with its line. A record outside the domain, a
 * type Porkbun cannot hold, `$INCLUDE` or `$GENERATE` is a problem: the file
 * is fixed rather than silently imported in part.
 */
export const parseZone = (text: string, domainName: string): ParsedZone => {
  const domain = lower(domainName);
  const { entries, problems: syntax } = entriesOf(text.replace(/^﻿/, ""));
  const problems: string[] = [...syntax];
  const records: ImportRecord[] = [];
  const ignored: Ignored[] = [];
  let origin = domain;
  let defaultTtl: number | undefined;
  let lastTtl: number | undefined;
  let lastOwner: string | undefined;

  for (const { line, inherits, tokens } of entries) {
    const at = `line ${String(line)}`;
    const first = tokens[0] as Token;
    if (!inherits && !first.quoted && first.raw.startsWith("$")) {
      const directive = first.raw.toUpperCase();
      const value = tokens[1];
      if (directive === "$ORIGIN" && value !== undefined) origin = absolute(value.raw, origin);
      else if (directive === "$TTL" && ttlOf(value) !== undefined) defaultTtl = ttlOf(value);
      else problems.push(`${at}: ${first.raw}${value === undefined ? " without a value" : ` ${value.raw}`} is not followed here; put its records in this file`);
      continue;
    }
    let rest = tokens;
    let owner = lastOwner;
    if (!inherits) {
      owner = absolute(first.raw, origin);
      rest = rest.slice(1);
    }
    if (owner === undefined) {
      problems.push(`${at}: a record with no owner name before it`);
      continue;
    }
    lastOwner = owner;
    let ttl: number | undefined;
    for (let k = 0; k < 2 && rest.length > 0; k += 1) {
      const head = rest[0] as Token;
      const asTtl = ttlOf(head);
      if (asTtl !== undefined && ttl === undefined) ttl = asTtl;
      else if (!head.quoted && CLASSES.has(head.raw.toUpperCase())) {
        if (head.raw.toUpperCase() !== "IN") problems.push(`${at}: class ${head.raw} is not the Internet class (IN)`);
      } else break;
      rest = rest.slice(1);
    }
    const typeToken = rest[0];
    if (typeToken === undefined || typeToken.quoted) {
      problems.push(`${at}: no record type`);
      continue;
    }
    const type = typeToken.raw.toUpperCase();
    const rdata = rest.slice(1);
    const effectiveTtl = ttl ?? defaultTtl ?? lastTtl;
    if (ttl !== undefined) lastTtl = ttl;

    const name = owner === domain ? "" : owner.endsWith(`.${domain}`) ? owner.slice(0, -domain.length - 1) : undefined;
    const shown = name === undefined ? owner : name === "" ? "@" : name;
    if (name === undefined) {
      problems.push(`${at}: ${owner} is not in ${domain}`);
      continue;
    }
    const why = NOT_IMPORTED[type];
    if (why !== undefined) {
      ignored.push({ line, name: shown, type, why });
      continue;
    }
    const record = (content: string, prio?: number): ImportRecord => ({
      name,
      type,
      content,
      ...(effectiveTtl === undefined ? {} : { ttl: effectiveTtl }),
      ...(prio === undefined ? {} : { prio }),
    });
    const arity = (n: number): boolean => {
      if (rdata.length === n) return true;
      problems.push(`${at}: ${type} takes ${String(n)} field${n === 1 ? "" : "s"}, found ${String(rdata.length)}`);
      return false;
    };
    if (type === "A" || type === "AAAA") {
      if (arity(1)) records.push(record((rdata[0] as Token).raw));
    } else if (HOST_TARGET.has(type)) {
      if (arity(1)) records.push(record(target((rdata[0] as Token).raw, origin)));
    } else if (type === "MX") {
      const prio = integer(rdata[0]);
      if (!arity(2)) continue;
      if (prio === undefined) problems.push(`${at}: MX preference ${(rdata[0] as Token).raw} is not a number from 0 to 65535`);
      else records.push(record(target((rdata[1] as Token).raw, origin), prio));
    } else if (type === "SRV") {
      if (!arity(4)) continue;
      const [prio, weight, port] = rdata.slice(0, 3).map(integer);
      if (prio === undefined || weight === undefined || port === undefined) problems.push(`${at}: SRV priority, weight and port must be numbers from 0 to 65535`);
      else records.push(record(`${String(weight)} ${String(port)} ${target((rdata[3] as Token).raw, origin)}`, prio));
    } else if (type === "TXT") {
      if (rdata.length === 0) problems.push(`${at}: TXT with no text`);
      else records.push(record(Buffer.concat(rdata.map((t) => bytesOf(t.raw))).toString("utf8")));
    } else if (AS_WRITTEN.has(type)) {
      if (rdata.length === 0) problems.push(`${at}: ${type} with no data`);
      else records.push(record(written(rdata)));
    } else {
      problems.push(`${at}: Porkbun cannot hold a ${type} record (it takes ${IMPORTABLE.join(", ")})`);
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, records, ignored };
};
