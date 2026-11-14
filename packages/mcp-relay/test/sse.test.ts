import { describe, expect, it } from "vitest";

import { dataOf, eventOf, makeSplitter, withData } from "../src/sse.js";

/** The events and the rest a splitter makes of these chunks, in this order. */
const cutInto = (chunks: readonly string[], maxPending = Number.MAX_SAFE_INTEGER): { events: string[]; rest: string; overflowed: boolean } => {
  const splitter = makeSplitter(maxPending);
  const cuts = chunks.map((chunk) => splitter.push(chunk));
  return { events: cuts.flatMap((cut) => [...cut.events]), rest: splitter.finish(), overflowed: cuts.some((cut) => cut.overflow) };
};

describe("makeSplitter", () => {
  it("cuts a stream at its blank lines and keeps what is left for the next chunk", () => {
    const { events, rest } = cutInto(['event: message\ndata: {"a":1}\n\n: ping\n\nid: 7\ndata: par']);
    expect(events).toEqual(['event: message\ndata: {"a":1}\n\n', ": ping\n\n"]);
    expect(rest).toBe("id: 7\ndata: par");
  });

  it("puts back together into exactly what was cut, whichever line ends it uses", () => {
    for (const text of ["data: a\n\ndata: b\n\n", "data: a\r\n\r\ndata: b\r\n\r\n", "data: a\r\n\ndata: b\n\r\n", "\n\ndata: a\n\n"]) {
      const { events, rest } = cutInto([text]);
      expect(events.join("") + rest).toBe(text);
      expect(rest).toBe("");
    }
    // A stream that ends in a bare CR waits for the byte that would make it half a CRLF; at the end of the stream the rest goes on as it is.
    const bare = cutInto(["data: a\r\rdata: b\r\r"]);
    expect(bare.events).toEqual(["data: a\r\r"]);
    expect(bare.events.join("") + bare.rest).toBe("data: a\r\rdata: b\r\r");
  });

  it("waits for the byte after a CR, which may be half of a CRLF", () => {
    expect(cutInto(["data: a\r\n\r"]).events).toEqual([]);
    expect(cutInto(["data: a\r\n\r", "\n"]).events).toEqual(["data: a\r\n\r\n"]);
  });

  it("gives the same events however the text is split into chunks, down to one character at a time", () => {
    const text = 'event: message\r\nid: 1\r\ndata: {"x":"\u0219"}\r\n\r\n: keep-alive\n\ndata: two\ndata: lines\n\ndata: tail\r\r\n\r\n';
    const whole = cutInto([text]);
    for (let at = 1; at < text.length; at += 1) {
      const split = cutInto([text.slice(0, at), text.slice(at)]);
      expect(split.events.join("") + split.rest).toBe(text);
      expect(split.events).toEqual(whole.events);
    }
    const singly = cutInto([...text]);
    expect(singly.events).toEqual(whole.events);
    expect(singly.rest).toBe(whole.rest);
  });

  it("looks at each character once: an event of megabytes, in small chunks, is cut in a moment", () => {
    const body = `data: ${"x".repeat(8 * 1024 * 1024)}\n\n`;
    const chunks: string[] = [];
    for (let at = 0; at < body.length; at += 1024) chunks.push(body.slice(at, at + 1024));
    const started = Date.now();
    const { events, rest } = cutInto(chunks);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(events).toHaveLength(1);
    expect((events[0] as string).length).toBe(body.length);
    expect(rest).toBe("");
  });

  it("says when what waits for its blank line outgrows the limit, and still hands back the events it finished", () => {
    const splitter = makeSplitter(100);
    expect(splitter.push("data: first\n\n" + "x".repeat(60))).toEqual({ events: ["data: first\n\n"], overflow: false });
    expect(splitter.push("y".repeat(60)).overflow).toBe(true);
    const finished = makeSplitter(100).push(`data: ${"z".repeat(500)}\n\n`);
    expect(finished.events).toHaveLength(1);
    expect(finished.overflow).toBe(false);
  });
});

describe("dataOf and withData", () => {
  it("reads the data lines of an event, joined by newlines, with or without the space after the colon", () => {
    expect(dataOf('event: message\ndata: {"a":1}\n\n')).toBe('{"a":1}');
    expect(dataOf("data:tight\n\n")).toBe("tight");
    expect(dataOf("data: one\ndata: two\n\n")).toBe("one\ntwo");
    expect(dataOf("data: one\r\ndata:  two\r\n\r\n")).toBe("one\n two");
    expect(dataOf(": ping\n\n")).toBeUndefined();
    expect(dataOf("id: 3\nretry: 100\n\n")).toBeUndefined();
  });

  it("writes new data in the place of the old, and leaves the other fields where they are", () => {
    expect(withData('event: message\nid: 4\ndata: {"old":true}\n\n', '{"new":true}')).toBe('event: message\nid: 4\ndata: {"new":true}\n\n');
    expect(withData("data: a\ndata: b\nid: 9\n\n", "c")).toBe("data: c\nid: 9\n\n");
    expect(withData("id: 9\r\ndata: a\r\n\r\n", "c")).toBe("id: 9\ndata: c\n\n");
    expect(withData("id: 9\n\n", "c")).toBe("id: 9\ndata: c\n\n");
    // Data of several lines goes back as several data lines, which a client joins as it joined them.
    expect(withData("id: 1\ndata: old\n\n", '{\n  "a": 1\n}')).toBe('id: 1\ndata: {\ndata:   "a": 1\ndata: }\n\n');
    expect(dataOf(withData("data: old\n\n", '{\n  "a": 1\n}'))).toBe('{\n  "a": 1\n}');
  });

  it("makes an event of a message", () => {
    expect(eventOf('{"id":1}')).toBe('event: message\ndata: {"id":1}\n\n');
    expect(dataOf(eventOf('{"id":1}'))).toBe('{"id":1}');
  });
});
