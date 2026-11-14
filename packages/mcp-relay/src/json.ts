/**
 * JSON read where it lies in its text. A relay that passes an answer on must
 * not rewrite it: parsing and printing a number again turns `12.50` into
 * `12.5`, `1e3` into `1000` and `9007199254740993` into `9007199254740992`.
 * So when the relay has to add something to a message (a note on a result, an
 * error for a call that was not made) or take a message out of a batch, it
 * finds the place in the original text, with the few functions here, and
 * cuts and splices the text; everything it does not touch stays the
 * characters it was.
 *
 * Pure, and only for text that already parsed as JSON: these find places, they
 * do not check. A place they cannot find is undefined (or -1 inside).
 */

export type Span = { readonly start: number; readonly end: number };

const SPACE = " \t\n\r";
const ENDS_A_LITERAL = `,]}${SPACE}`;

const skipSpace = (text: string, at: number): number => {
  let i = at;
  while (i < text.length && SPACE.includes(text[i] as string)) i += 1;
  return i;
};

/** Where the string that starts at `at` ends (after its closing quote), or -1. */
const stringEnd = (text: string, at: number): number => {
  for (let i = at + 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\") i += 1;
    else if (char === '"') return i + 1;
  }
  return -1;
};

/** Where the value that starts at `at` (not at a space) ends, or -1. */
const valueEnd = (text: string, at: number): number => {
  const first = text[at];
  if (first === '"') return stringEnd(text, at);
  if (first === "{" || first === "[") {
    let depth = 0;
    for (let i = at; i < text.length; i += 1) {
      const char = text[i];
      if (char === '"') {
        const end = stringEnd(text, i);
        if (end < 0) return -1;
        i = end - 1;
      } else if (char === "{" || char === "[") depth += 1;
      else if (char === "}" || char === "]") {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }
  let i = at;
  while (i < text.length && !ENDS_A_LITERAL.includes(text[i] as string)) i += 1;
  return i > at ? i : -1;
};

/** The members of the object that starts at `at`, each with its key and where its value lies. */
export const membersOf = (text: string, at: number): readonly { readonly key: string; readonly value: Span }[] | undefined => {
  if (text[at] !== "{") return undefined;
  const members: { key: string; value: Span }[] = [];
  let i = skipSpace(text, at + 1);
  while (text[i] !== "}") {
    if (text[i] !== '"') return undefined;
    const keyEnd = stringEnd(text, i);
    if (keyEnd < 0) return undefined;
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    i = skipSpace(text, keyEnd);
    if (text[i] !== ":") return undefined;
    const start = skipSpace(text, i + 1);
    const end = valueEnd(text, start);
    if (end < 0) return undefined;
    members.push({ key, value: { start, end } });
    i = skipSpace(text, end);
    if (text[i] === ",") i = skipSpace(text, i + 1);
    else if (text[i] !== "}") return undefined;
  }
  return members;
};

/** Where each member of the array that starts at `at` lies. */
export const elementsOf = (text: string, at: number): readonly Span[] | undefined => {
  if (text[at] !== "[") return undefined;
  const elements: Span[] = [];
  let i = skipSpace(text, at + 1);
  while (text[i] !== "]") {
    const end = valueEnd(text, i);
    if (end < 0) return undefined;
    elements.push({ start: i, end });
    i = skipSpace(text, end);
    if (text[i] === ",") i = skipSpace(text, i + 1);
    else if (text[i] !== "]") return undefined;
  }
  return elements;
};

/** The value of a key, as JSON.parse reads an object with a repeated one: the last. */
const lastOf = (members: readonly { readonly key: string; readonly value: Span }[] | undefined, key: string): Span | undefined =>
  members?.findLast((member) => member.key === key)?.value;

/** The messages of a request or an answer: where each of a batch's lies, or where the one message does. */
export const messageSpans = (text: string): readonly Span[] | undefined => {
  const start = skipSpace(text, 0);
  if (text[start] === "[") return elementsOf(text, start);
  const end = text[start] === "{" ? valueEnd(text, start) : -1;
  return end < 0 ? undefined : [{ start, end }];
};

/** A message's `id`, as it was written. */
export const idSourceOf = (text: string, message: Span): string | undefined => {
  const id = lastOf(membersOf(text, message.start), "id");
  return id === undefined ? undefined : text.slice(id.start, id.end);
};

/** A message's text. */
export const textOf = (text: string, message: Span): string => text.slice(message.start, message.end);

/**
 * Where an item is added to the content of the response in `message`
 * (`result.content`): the offset to insert at, and whether the content has an
 * item already, so that a comma goes before the new one.
 */
export const contentEndOf = (text: string, message: Span): { readonly at: number; readonly after: boolean } | undefined => {
  const result = lastOf(membersOf(text, message.start), "result");
  if (result === undefined) return undefined;
  const content = lastOf(membersOf(text, result.start), "content");
  if (content === undefined) return undefined;
  const items = elementsOf(text, content.start);
  if (items === undefined) return undefined;
  const last = items.at(-1);
  return last === undefined ? { at: content.start + 1, after: false } : { at: last.end, after: true };
};

export type Edit = { readonly at: number; readonly insert: string };

/** The text with each insertion made at its offset in the original, whatever order they come in. */
export const splice = (text: string, edits: readonly Edit[]): string =>
  [...edits].sort((a, b) => b.at - a.at).reduce((result, edit) => `${result.slice(0, edit.at)}${edit.insert}${result.slice(edit.at)}`, text);

/** The messages of a batch with `before` (already JSON) put in front of its own; a single message becomes a batch of them all. */
export const prepend = (text: string, before: readonly string[]): string => {
  const start = skipSpace(text, 0);
  const lead = before.join(",");
  if (text[start] !== "[") return `[${lead},${text.trim()}]`;
  const empty = skipSpace(text, start + 1) === text.lastIndexOf("]");
  return splice(text, [{ at: start + 1, insert: empty ? lead : `${lead},` }]);
};
