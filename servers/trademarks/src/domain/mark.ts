/**
 * A trade mark as every register here reports it, whatever the office calls
 * its fields. infra/ maps each source's wire shape onto this; nothing above
 * infra/ sees a wire field.
 */

/** The offices a search can name. Only some have a source (coverage.ts says why the others do not). */
export const OFFICES = ["EM", "US", "RO", "WO"] as const;
export type Office = (typeof OFFICES)[number];

/** `exact`: the mark's text is the name. `word`: it contains the name. `similar`: whatever the source counts as close (sounds like, one letter off). */
export const MATCH_MODES = ["exact", "word", "similar"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

/** `live`: registered or pending, the marks that can stand in a new name's way. */
export const STATUS_FILTERS = ["live", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** `pending`: filed and not yet registered (examined, published, opposed, appealed). `dead`: refused, withdrawn, cancelled, expired. */
export type MarkStatus = "registered" | "pending" | "dead";

/** How the mark's text stands to the name searched (match.ts). */
export type Relation = "identical" | "contains" | "similar";

/** `word`: standard characters. `figurative`: stylised or with a design. Anything else in the office's own word. */
export type MarkKind = string;

export type Mark = {
  readonly office: Office;
  /** The office's own number for it: a USPTO serial number, an EUIPO application number. */
  readonly id: string;
  /** The verbal element; null for a mark with no words (a logo, a sound). */
  readonly mark: string | null;
  readonly status: MarkStatus;
  /** The office's own words for where it stands ("NON-FINAL ACTION - MAILED", "OPPOSITION_PENDING"). */
  readonly statusText: string;
  /** Applicants or registrants. Empty where the office withholds them (EUIPO, until the filing fee is paid). */
  readonly owners: readonly string[];
  /** Nice classes it covers now; a dead mark, the classes it had. */
  readonly classes: readonly number[];
  readonly kind?: MarkKind;
  /** yyyy-mm-dd. */
  readonly filed?: string;
  readonly registered?: string;
  readonly registrationNumber?: string;
  /** The office's record of what the words mean in English, where it keeps one: why a mark in other words can still be close. */
  readonly translation?: string;
  /** The office's own page for it, for a human to read. */
  readonly link: string;
};

export type GoodsAndServices = {
  readonly class: number;
  /** The office cancelled this class of the mark (a partial cancellation, a dead registration). */
  readonly cancelled?: true;
  readonly terms: string;
};

export type MarkDetail = Mark & {
  readonly goodsAndServices: readonly GoodsAndServices[];
  readonly expires?: string;
  /** When it last changed status, where the office says. */
  readonly statusDate?: string;
};

/** One step in a mark's file, as the office records it ("NEW APPLICATION ENTERED", "REGISTERED-PRINCIPAL REGISTER"). */
export type MarkEvent = {
  /** yyyy-mm-dd. */
  readonly date: string;
  /** The office's code for the step. */
  readonly code: string;
  readonly description: string;
  /** Its place in the file: the office numbers steps in order. */
  readonly number: number;
};

/** Where a mark stands now, and every step that brought it there, newest first. */
export type MarkHistory = {
  readonly office: Office;
  readonly id: string;
  readonly mark: string | null;
  readonly status: MarkStatus;
  /** The office's own sentence for where it stands. */
  readonly statusText: string;
  /** The office's status code (USPTO: 800 renewed, 602 abandoned, ...). */
  readonly statusCode: number;
  readonly statusDate?: string;
  /** The office's summary category ("LIVE/REGISTRATION/Issued and Active"). */
  readonly category?: string;
  readonly filed?: string;
  readonly registered?: string;
  readonly registrationNumber?: string;
  readonly renewed?: string;
  readonly abandoned?: string;
  readonly events: readonly MarkEvent[];
  readonly link: string;
};

/** One document in a mark's file. */
export type MarkDocument = {
  /** yyyy-mm-dd, the day the office received or sent it. */
  readonly date: string;
  /** The office's document type code ("OOA" an office action, "SPE" a specimen); download_mark_documents filters on it. */
  readonly type: string;
  readonly description: string;
  /** "incoming" (filed with the office), "outgoing" (sent by it), in the office's word. */
  readonly category: string;
  readonly pages?: number;
};

/** Which of a mark's documents to fetch: a type code, and a window of dates (both ends included). */
export type DocumentFilter = { readonly type?: string | undefined; readonly from?: string | undefined; readonly to?: string | undefined };
