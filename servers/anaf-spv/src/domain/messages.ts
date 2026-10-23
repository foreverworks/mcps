import { addDays, compact } from "@foreverworks/mcp-kit";

import { dateAt, dayStart, isoAt } from "./dates.js";

/**
 * One row of SPV's message list ("Mesaje"): a document ANAF put in the
 * taxpayer's virtual space, or the answer to one they requested.
 *
 * SPV gives a row no id of its own: the download link is the row's position
 * in the current listing. So a message is named by `key`, a hash of what the
 * row shows, which stays the same between listings and sessions; two rows
 * that show exactly the same thing get `-2`, `-3` in listing order. Pure.
 */
export type Message = {
  readonly key: string;
  /** The tax id the document is for: a CNP for a person, a CUI for a company. */
  readonly cif: string;
  /** SPV's document type, as its list prints it: DECIZIE, SOMATII, RASPUNS SOLICITARE, PLATA, ... */
  readonly type: string;
  /** For an answer to a request: the request's id (request_document returns it). */
  readonly requestId: string | undefined;
  readonly postedAtMs: number;
  /** When the row leaves the list and the document can no longer be downloaded. */
  readonly archivedAtMs: number | undefined;
  readonly details: string;
};

/** A row as the portal shows it, before it is named. */
export type MessageRow = Omit<Message, "key">;

/**
 * FNV-1a, 64 bits, as hex: a stable name for a row, not a security property.
 * A collision among one taxpayer's few hundred rows is about 1 in 10^14.
 */
const fnv1a64 = (text: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
};

const fingerprint = (row: MessageRow): string => [row.cif, row.type, row.requestId ?? "", String(row.postedAtMs), row.details].join("\u001f");

/** Every row named, in the order given; a repeated fingerprint gets an ordinal. */
export const keyed = (rows: readonly MessageRow[]): readonly Message[] => {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = fnv1a64(fingerprint(row));
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { key: n === 1 ? base : `${base}-${n}`, ...row };
  });
};

/** Lower case, no diacritics, single spaces: how a type or a phrase is compared. */
export const folded = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export type Selection = {
  readonly type?: string | undefined;
  readonly cif?: string | undefined;
  readonly requestId?: string | undefined;
  /** A phrase the details must contain. */
  readonly text?: string | undefined;
  /** Calendar dates in Bucharest, inclusive. */
  readonly since?: string | undefined;
  readonly until?: string | undefined;
};

export const matches =
  (s: Selection) =>
  (m: Message): boolean =>
    (s.type === undefined || folded(m.type) === folded(s.type)) &&
    (s.cif === undefined || m.cif === s.cif.trim()) &&
    (s.requestId === undefined || m.requestId === s.requestId.trim()) &&
    (s.text === undefined || folded(m.details).includes(folded(s.text))) &&
    (s.since === undefined || m.postedAtMs >= dayStart(s.since)) &&
    (s.until === undefined || m.postedAtMs < dayStart(addDays(s.until, 1)));

/** Newest first, then by key so the order is total. */
export const newestFirst = (a: Message, b: Message): number => b.postedAtMs - a.postedAtMs || a.key.localeCompare(b.key);

/** What a client sees of a message. */
export const messageView = (m: Message) =>
  compact({
    key: m.key,
    type: m.type,
    cif: m.cif,
    request_id: m.requestId,
    posted_at: isoAt(m.postedAtMs),
    archived_at: m.archivedAtMs === undefined ? undefined : isoAt(m.archivedAtMs),
    details: m.details,
  });

/** The types present in a listing, with how many of each: what a `type` filter can be. */
export const typeCounts = (messages: readonly Message[]): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const m of messages) counts[m.type] = (counts[m.type] ?? 0) + 1;
  return counts;
};

const slug = (text: string): string =>
  folded(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "document";

/** A file name SPV's own name cannot escape a folder with: letters, digits, dot, dash, underscore. */
export const safeName = (name: string): string => {
  const cleaned = name.replace(/[/\\]/g, "_").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "document.pdf";
};

/** Runs of six or more digits: the shape of every id SPV puts in a file name (request ids, registration numbers, SV numbers). */
const idsIn = (text: string): readonly string[] => text.match(/\d{6,}/g) ?? [];

/**
 * The ids a row shows that SPV also puts in the name of the file it serves:
 * the request id (`<request id>_Obligatii_de_plata.pdf`, a payment's
 * `<request id>_spv_plati.pdf`) and a registration number in the details (a
 * contact form answer's `FormularUnic_<number>.pdf`, a receipt's
 * `<number>.pdf` for INTERNT-<number>-2026). Never the tax id, which every
 * row of the account shares.
 */
export const ownIds = (m: MessageRow): readonly string[] => [...new Set([...(m.requestId === undefined ? [] : [m.requestId]), ...idsIn(m.details)])].filter((id) => id !== m.cif);

/**
 * Whether the file SPV served for `m` can be its document, judged by the
 * name SPV gave it (a download that landed on another row once saved
 * another message's PDF under this one's metadata). Pure.
 *
 * - The name carries one of the row's own ids: it is the row's.
 * - It carries an id another row of the listing owns: it is that row's.
 * - The row has an id of its own and the name carries a different one: it
 *   belongs to some other message.
 * - Otherwise there is nothing to tell them apart and the file is taken: SPV
 *   names decisions by an SV number no row shows (`SV<number>.pdf`), and a
 *   bank report F2102 by its type alone (`F2102_SPV_ANAF_f2102.xml.pdf`).
 */
export const servedNameFits = (m: Message, served: string, listing: readonly Message[]): { readonly ok: true } | { readonly ok: false; readonly reason: string } => {
  const own = ownIds(m);
  const named = idsIn(served).filter((id) => id !== m.cif);
  if (named.some((id) => own.includes(id))) return { ok: true };
  const owner = listing.find((o) => o.key !== m.key && named.some((id) => ownIds(o).includes(id)));
  if (owner !== undefined) {
    const id = named.find((x) => ownIds(owner).includes(x));
    return { ok: false, reason: `SPV served "${served}", which carries ${id}, the id of another message (${owner.type}${owner.requestId === undefined ? "" : ` ${owner.requestId}`})` };
  }
  if (own.length > 0 && named.length > 0) return { ok: false, reason: `SPV served "${served}", which does not carry this message's id ${own.join(" or ")}` };
  return { ok: true };
};

/**
 * Where a downloaded document is saved: the Bucharest date it was posted, its
 * type, and the name SPV gave the file (`SV00000000001.pdf`,
 * `190000004_D212.pdf`), so a folder of them sorts by date and says what each is.
 */
export const fileNameFor = (m: Message, served: string): string => `${dateAt(m.postedAtMs)}_${slug(m.type)}_${safeName(served)}`;
