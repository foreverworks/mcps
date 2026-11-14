/**
 * Server-sent events, as much of them as a relay needs: cut a stream into
 * its events as the bytes arrive, read the data of one, and write an event
 * back with other data. The splitter is the one piece of state, in a closure;
 * the stream itself is the caller's.
 *
 * An event is the lines up to a blank line. Lines end in LF, CRLF or CR. An
 * event that is not changed is passed on exactly as it came, so the relay
 * alters nothing but the data it was asked to alter.
 */

/** What a splitter hands back for a chunk: the events it completed, and whether the text waiting for its blank line has outgrown the limit. */
export type Cut = { readonly events: readonly string[]; readonly overflow: boolean };

export type Splitter = {
  /** Takes the next text of the stream. */
  readonly push: (chunk: string) => Cut;
  /** What is left at the end of the stream: an event that never got its blank line, and a CR that waited for a byte that did not come. */
  readonly finish: () => string;
};

/**
 * Cuts a stream into its events as the text arrives. Each event comes with the
 * blank line that ends it, so the events put back together are the stream. A
 * CR at the very end of a chunk waits for the next one: it may be half a CRLF.
 *
 * Every character is looked at once, whatever the size of the chunks: the
 * state is whether the line being read is still empty, and the text of the
 * event so far, kept in the pieces it came in. `maxPending` bounds that text,
 * for an upstream that never sends a blank line.
 */
export const makeSplitter = (maxPending: number): Splitter => {
  let parts: string[] = [];
  let size = 0;
  let atLineStart = true;
  let held = "";
  return {
    push: (chunk) => {
      const text = held + chunk;
      held = "";
      const events: string[] = [];
      let from = 0;
      for (let i = 0; i < text.length; ) {
        const char = text[i];
        if (char !== "\n" && char !== "\r") {
          atLineStart = false;
          i += 1;
          continue;
        }
        if (char === "\r" && i === text.length - 1) {
          held = "\r";
          break;
        }
        const next = i + (char === "\r" && text[i + 1] === "\n" ? 2 : 1);
        const blank = atLineStart;
        atLineStart = true;
        i = next;
        if (blank) {
          events.push(parts.join("") + text.slice(from, next));
          parts = [];
          size = 0;
          from = next;
        }
      }
      const end = held === "" ? text.length : text.length - 1;
      if (end > from) {
        parts.push(text.slice(from, end));
        size += end - from;
      }
      return { events, overflow: size > maxPending };
    },
    finish: () => {
      const rest = parts.join("") + held;
      parts = [];
      held = "";
      size = 0;
      return rest;
    },
  };
};

const LINE_END = /\r\n|\n|\r/;

/** An event's `data` lines joined by newlines, as the specification reads them; undefined when it has none. */
export const dataOf = (event: string): string | undefined => {
  const lines = event.split(LINE_END).flatMap((line) => (line.startsWith("data:") ? [line.slice(line.startsWith("data: ") ? 6 : 5)] : []));
  return lines.length === 0 ? undefined : lines.join("\n");
};

/** The event with its data lines replaced by `data`, one line for each of its lines; its other fields stay where they were. */
export const withData = (event: string, data: string): string => {
  const lines = event.split(LINE_END);
  while (lines.at(-1) === "") lines.pop();
  const written = data.split("\n").map((line) => `data: ${line}`);
  const out: string[] = [];
  let placed = false;
  for (const line of lines) {
    if (!line.startsWith("data:")) out.push(line);
    else if (!placed) {
      out.push(...written);
      placed = true;
    }
  }
  if (!placed) out.push(...written);
  return `${out.join("\n")}\n\n`;
};

/** A message as an event of its own, for one the relay itself has to put into a stream. */
export const eventOf = (data: string): string => `event: message\ndata: ${data}\n\n`;
