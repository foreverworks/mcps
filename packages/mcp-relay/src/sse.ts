/**
 * Server-sent events, as much of them as a relay needs: cut a stream into
 * its events as the bytes arrive, read the data of one, and write an event
 * back with other data. Pure; the stream itself is the caller's.
 *
 * An event is the lines up to a blank line. Lines end in LF, CRLF or CR. An
 * event that is not changed is passed on exactly as it came, so the relay
 * alters nothing but the data it was asked to alter.
 */

/**
 * The events complete in `buffer`, each with the blank line that ends it
 * (so they put back together into what was cut), and the text after the last
 * one. A CR at the very end waits for the next chunk: it may be half a CRLF.
 */
export const splitEvents = (buffer: string): { readonly events: readonly string[]; readonly rest: string } => {
  const events: string[] = [];
  let start = 0;
  let lineStart = 0;
  for (let i = 0; i < buffer.length; ) {
    const char = buffer[i];
    if (char !== "\n" && char !== "\r") {
      i += 1;
      continue;
    }
    if (char === "\r" && i === buffer.length - 1) break;
    const next = i + (char === "\r" && buffer[i + 1] === "\n" ? 2 : 1);
    const blank = i === lineStart;
    lineStart = next;
    i = next;
    if (blank) {
      events.push(buffer.slice(start, next));
      start = next;
    }
  }
  return { events, rest: buffer.slice(start) };
};

const LINE_END = /\r\n|\n|\r/;

/** An event's `data` lines joined by newlines, as the specification reads them; undefined when it has none. */
export const dataOf = (event: string): string | undefined => {
  const lines = event.split(LINE_END).flatMap((line) => (line.startsWith("data:") ? [line.slice(line.startsWith("data: ") ? 6 : 5)] : []));
  return lines.length === 0 ? undefined : lines.join("\n");
};

/** The event with its data lines replaced by one line holding `data`; its other fields stay where they were. */
export const withData = (event: string, data: string): string => {
  const lines = event.split(LINE_END);
  while (lines.at(-1) === "") lines.pop();
  const out: string[] = [];
  let placed = false;
  for (const line of lines) {
    if (!line.startsWith("data:")) out.push(line);
    else if (!placed) {
      out.push(`data: ${data}`);
      placed = true;
    }
  }
  if (!placed) out.push(`data: ${data}`);
  return `${out.join("\n")}\n\n`;
};

/** A message as an event of its own, for one the relay itself has to put into a stream. */
export const eventOf = (data: string): string => `event: message\ndata: ${data}\n\n`;
