import { fail, inputError } from "./errors.js";

/**
 * SPV's contact form ("Formular de contact", the envelope pictogram), as
 * measured: what it offers, and the rules a message must meet
 * before anything is sent. Pure.
 *
 * The form preselects its FIRST identity, which for an account that also
 * represents a company is the company: a message sent without choosing would
 * reach ANAF on the wrong tax id. So the identity is always given, checked
 * against the form's own list, and read back.
 */

export type Choice = { readonly value: string; readonly label: string };

/** The form as the page renders it. */
export type ContactForm = {
  /** The tax ids the account may write as (`cif_ales`), with their labels ("<cif> -- <name>"). */
  readonly identities: readonly Choice[];
  /** The identity the page has selected before anyone chooses. */
  readonly preselected: string | undefined;
  /** The categories (`categSolicit`), without the "choose" placeholder. */
  readonly categories: readonly Choice[];
  /**
   * The subcategories (`subcategSolicit`), one group per category that takes
   * them: named by the category where the page marks it (`data-xxx`), else
   * `undefined` and in the page's order.
   */
  readonly subcategoryGroups: readonly { readonly category: string | undefined; readonly choices: readonly Choice[] }[];
  /** The text's limit (`textintrebare`'s maxlength). */
  readonly textMax: number;
};

/** "Asistență și îndrumare de specialitate în domeniul fiscal": the category whose requests get an answer on the merits. */
export const DEFAULT_CATEGORY = 3;

/**
 * The categories that take a subcategory, in the order the page lists their
 * groups (measured: petitions under OG 27/2002, public information
 * under Law 544/2001, technical help), for a page that does not mark which
 * group is whose.
 */
export const SUBCATEGORY_CATEGORIES = ["1", "2", "5"] as const;

export const ATTACHMENT_TYPES = ["pdf", "tiff", "rtf", "zip", "jpeg", "jpg", "gif", "png"] as const;
/** "să nu depăşească 10 MB" (the form). */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Typographic characters a person types that have a plain equivalent. */
const PLAIN: ReadonlyArray<readonly [RegExp, string]> = [
  [/[“”„‟«»]/g, '"'],
  [/[‘’‚‛]/g, "'"],
  [/[‐-―−]/g, "-"],
  [/…/g, "..."],
  [/[   ]/g, " "],
];

/**
 * The text as it will be sent: diacritics stripped (ă â î ș ț and their
 * cedilla forms become a a i s t), typographic quotes and dashes made plain,
 * line breaks as `\n`. Anything else outside printable ASCII is refused rather
 * than sent mangled. Counted as the page counts it, a line break as one.
 */
export const plainText = (text: string, max: number): string => {
  let plain = text.replace(/\r\n?/g, "\n").normalize("NFD").replace(/\p{M}/gu, "");
  for (const [pattern, replacement] of PLAIN) plain = plain.replace(pattern, replacement);
  plain = plain.trim();
  const odd = [...new Set([...plain].filter((c) => !/[\x20-\x7E\n\t]/.test(c)))];
  if (odd.length > 0) fail(inputError(`the text holds characters SPV's form may not keep (${odd.slice(0, 8).join(" ")}); write them out in plain letters`));
  if (plain.length === 0) fail(inputError("the text is empty"));
  if (plain.length > max) fail(inputError(`the text is ${plain.length} characters after stripping diacritics; SPV's form takes at most ${max}. Put the full wording in an attached PDF`));
  return plain;
};

/** An attachment's name as SPV takes it: no diacritics, plain letters, digits, dot, dash, underscore, and one of its extensions. */
export const attachmentName = (name: string): string => {
  const plain = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "");
  const ext = /\.([A-Za-z0-9]+)$/.exec(plain)?.[1]?.toLowerCase();
  if (ext === undefined || !(ATTACHMENT_TYPES as readonly string[]).includes(ext)) {
    fail(inputError(`SPV's form takes an attachment of type ${ATTACHMENT_TYPES.join(", ")}, not "${name}"`));
  }
  return plain.slice(-120);
};

export const attachmentFits = (name: string, bytes: number): void => {
  if (bytes === 0) fail(inputError(`the attachment ${name} is empty`));
  if (bytes > ATTACHMENT_MAX_BYTES) fail(inputError(`the attachment ${name} is ${bytes} bytes; SPV's form takes at most 10 MB`));
};

export type ContactArgs = {
  readonly cif: string;
  readonly category: number;
  readonly subcategory: number | undefined;
  readonly text: string;
};

/** What will be sent, every value one the form offers. */
export type ContactPlan = {
  readonly identity: Choice;
  readonly category: Choice;
  readonly subcategory: Choice | undefined;
  readonly text: string;
};

const choice = (choices: readonly Choice[], value: string): Choice | undefined => choices.find((c) => c.value === value);

/** A category's subcategories: its own group where the page names it, else the group in its place in SUBCATEGORY_CATEGORIES. */
const subcategoriesOf = (form: ContactForm, category: string): readonly Choice[] => {
  const named = form.subcategoryGroups.find((g) => g.category === category);
  if (named !== undefined) return named.choices;
  if (form.subcategoryGroups.some((g) => g.category !== undefined)) return [];
  const place = SUBCATEGORY_CATEGORIES.indexOf(category as (typeof SUBCATEGORY_CATEGORIES)[number]);
  return place < 0 ? [] : (form.subcategoryGroups[place]?.choices ?? []);
};

/**
 * Check a message against the live form: the identity one it lists, the
 * category one it offers, a subcategory exactly where the category takes one
 * and from that category's group, the text within its limit. Nothing is sent
 * until this has passed.
 */
export const planFor = (form: ContactForm, args: ContactArgs): ContactPlan => {
  const cif = args.cif.trim();
  const identity = choice(form.identities, cif) ?? fail(inputError(`SPV's contact form lets this account write as ${form.identities.map((i) => i.value).join(", ")}, not ${cif}`));
  const category =
    choice(form.categories, String(args.category)) ??
    fail(inputError(`SPV's contact form offers the categories ${form.categories.map((c) => `${c.value} (${c.label})`).join(", ")}, not ${args.category}`));
  const subcategories = subcategoriesOf(form, category.value);
  if (subcategories.length === 0 && args.subcategory !== undefined) fail(inputError(`category ${category.value} takes no subcategory; drop it`));
  if (subcategories.length > 0 && args.subcategory === undefined) {
    fail(inputError(`category ${category.value} needs a subcategory: ${subcategories.map((s) => `${s.value} (${s.label})`).join(", ")}`));
  }
  const subcategory =
    args.subcategory === undefined
      ? undefined
      : (choice(subcategories, String(args.subcategory)) ??
        fail(inputError(`category ${category.value} takes the subcategories ${subcategories.map((s) => `${s.value} (${s.label})`).join(", ")}, not ${args.subcategory}`)));
  return { identity, category, subcategory, text: plainText(args.text, form.textMax) };
};

/** What SPV shows after it registered a message. */
export type ContactRegistered = {
  readonly registrationNumber: string;
  /** dd.mm.yyyy, as shown. */
  readonly registeredOn: string;
  readonly shownCif: string | undefined;
  readonly shownText: string | undefined;
};

/** Two texts the same once line breaks and runs of spaces are one space: how SPV echoes what it got. */
export const sameText = (a: string, b: string): boolean => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
