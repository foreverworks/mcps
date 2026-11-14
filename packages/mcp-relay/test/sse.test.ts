import { describe, expect, it } from "vitest";

import { dataOf, eventOf, splitEvents, withData } from "../src/sse.js";

describe("splitEvents", () => {
  it("cuts a stream at its blank lines and keeps what is left for the next chunk", () => {
    const { events, rest } = splitEvents('event: message\ndata: {"a":1}\n\n: ping\n\nid: 7\ndata: par');
    expect(events).toEqual(['event: message\ndata: {"a":1}\n\n', ": ping\n\n"]);
    expect(rest).toBe("id: 7\ndata: par");
  });

  it("puts back together into exactly what was cut, whichever line ends it uses", () => {
    for (const text of ["data: a\n\ndata: b\n\n", "data: a\r\n\r\ndata: b\r\n\r\n", "data: a\r\n\ndata: b\n\r\n", "\n\ndata: a\n\n"]) {
      const { events, rest } = splitEvents(text);
      expect(events.join("") + rest).toBe(text);
      expect(rest).toBe("");
    }
    // A stream that ends in a bare CR waits for the byte that would make it half a CRLF; at the end of the stream the rest goes on as it is.
    const bare = splitEvents("data: a\r\rdata: b\r\r");
    expect(bare.events).toEqual(["data: a\r\r"]);
    expect(bare.events.join("") + bare.rest).toBe("data: a\r\rdata: b\r\r");
  });

  it("waits for the byte after a CR, which may be half of a CRLF", () => {
    expect(splitEvents("data: a\r\n\r").events).toEqual([]);
    expect(splitEvents("data: a\r\n\r\n").events).toEqual(["data: a\r\n\r\n"]);
  });

  it("gives the same events however the text is split into chunks", () => {
    const text = 'event: message\r\nid: 1\r\ndata: {"x":"ș"}\r\n\r\n: keep-alive\n\ndata: two\ndata: lines\n\n';
    const whole = splitEvents(text).events;
    for (let at = 1; at < text.length; at += 1) {
      const first = splitEvents(text.slice(0, at));
      const second = splitEvents(first.rest + text.slice(at));
      expect([...first.events, ...second.events]).toEqual(whole);
    }
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
  });

  it("makes an event of a message", () => {
    expect(eventOf('{"id":1}')).toBe('event: message\ndata: {"id":1}\n\n');
    expect(dataOf(eventOf('{"id":1}'))).toBe('{"id":1}');
  });
});
