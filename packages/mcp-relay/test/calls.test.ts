import { describe, expect, it } from "vitest";

import { failedCall, inboxPathsIn, linkUris, messagesOf, namesBelow, outboxPathOf, stringsIn, toolCallArguments, withNote } from "../src/calls.js";

describe("the messages of a request", () => {
  it("are one, or the members of a batch", () => {
    expect(messagesOf({ id: 1 })).toEqual([{ id: 1 }]);
    expect(messagesOf([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("are tool calls when they have the method and an id to answer", () => {
    expect(toolCallArguments({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "x", arguments: { a: 1 } } })).toEqual({ id: 4, arguments: { a: 1 } });
    expect(toolCallArguments({ jsonrpc: "2.0", id: "s", method: "tools/call", params: { name: "x" } })).toEqual({ id: "s", arguments: undefined });
    expect(toolCallArguments({ jsonrpc: "2.0", method: "tools/call", params: { arguments: {} } })).toBeUndefined();
    expect(toolCallArguments({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBeUndefined();
    expect(toolCallArguments("tools/call")).toBeUndefined();
    expect(toolCallArguments(null)).toBeUndefined();
  });
});

describe("the strings in arguments", () => {
  it("are the values anywhere in them, not the keys, and not the numbers", () => {
    expect(stringsIn({ a: "one", b: ["two", { c: "three", "/key/path": 4 }], d: 5, e: null, f: true })).toEqual(["one", "two", "three"]);
  });

  it("skip the empty and the too long, and stop at a depth no argument has", () => {
    expect(stringsIn(["", "x".repeat(4097), "ok"])).toEqual(["ok"]);
    let deep: unknown = "bottom";
    for (let i = 0; i < 200; i += 1) deep = [deep];
    expect(stringsIn(deep)).toEqual([]);
  });
});

describe("the inbox paths among arguments", () => {
  const inbox = "/srv/inbox";

  it("are the absolute paths below the inbox, each once, once . and .. are resolved", () => {
    expect(inboxPathsIn({ path: "/srv/inbox/a.pdf", more: ["/srv/inbox/sub/../b.pdf", "/srv/inbox/a.pdf", "/srv/inbox/./c.pdf"] }, inbox)).toEqual(["/srv/inbox/a.pdf", "/srv/inbox/b.pdf", "/srv/inbox/c.pdf"]);
  });

  it("are not paths that climb out, other folders, relative names, the inbox itself, a sibling with the same start, or anything with a NUL", () => {
    expect(
      inboxPathsIn(["/srv/inbox/../etc/passwd", "/srv/inbox-other/a", "/srv/other/a", "a.pdf", "./a.pdf", "/srv/inbox", "/srv/inbox/", "/srv/inbox/a\0b", "see /srv/inbox/a.pdf", "file:///srv/inbox/a.pdf"], inbox),
    ).toEqual([]);
  });

  it("are none when there is nothing to look in", () => {
    expect(inboxPathsIn(undefined, inbox)).toEqual([]);
    expect(inboxPathsIn(42, inbox)).toEqual([]);
  });

  it("break into the names the file endpoints take", () => {
    expect(namesBelow(inbox, "/srv/inbox/2026-09/a b.pdf")).toEqual(["2026-09", "a b.pdf"]);
  });
});

describe("the links of a response", () => {
  const response = (content: unknown[]) => ({ jsonrpc: "2.0", id: 1, result: { content } });

  it("are the uris of its resource_link items, and nothing else's", () => {
    expect(
      linkUris(response([{ type: "text", text: "file:///srv/out/a.txt" }, { type: "resource_link", uri: "file:///srv/out/a.txt", name: "a" }, { type: "resource_link", name: "no uri" }, { type: "resource", resource: { uri: "file:///x" } }])),
    ).toEqual(["file:///srv/out/a.txt"]);
    expect(linkUris({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "x" } })).toEqual([]);
    expect(linkUris({ method: "notifications/progress", params: {} })).toEqual([]);
    expect(linkUris(null)).toEqual([]);
  });

  it("name a local file when they are file: uris below the outbox", () => {
    const outbox = "/srv/out";
    expect(outboxPathOf("file:///srv/out/a.txt", outbox)).toBe("/srv/out/a.txt");
    expect(outboxPathOf("file:///srv/out/2026-09/invoice%207.pdf", outbox)).toBe("/srv/out/2026-09/invoice 7.pdf");
    expect(outboxPathOf("file://localhost/srv/out/a.txt", outbox)).toBe("/srv/out/a.txt");
    for (const other of [
      "https://example.com/srv/out/a.txt",
      "file:///srv/out",
      "file:///srv/out/",
      "file:///srv/other/a.txt",
      "file:///srv/out/../etc/passwd",
      "file:///srv/out/%2e%2e/etc/passwd",
      "file:///srv/outside/a.txt",
      "file:///srv/out%2Fa.txt",
      "file://elsewhere.example/srv/out/a.txt",
      "/srv/out/a.txt",
      "not a uri",
    ]) {
      expect(outboxPathOf(other, outbox)).toBeUndefined();
    }
  });

  it("get one text item added at the end, and no other message changes", () => {
    const original = response([{ type: "text", text: "done" }]);
    expect(withNote(original, "could not fetch a.txt")).toEqual(response([{ type: "text", text: "done" }, { type: "text", text: "could not fetch a.txt" }]));
    expect(original.result.content).toHaveLength(1);
    const notification = { method: "notifications/progress", params: {} };
    expect(withNote(notification, "x")).toBe(notification);
  });
});

describe("a call that was not made", () => {
  it("is answered by its id with a JSON-RPC error", () => {
    expect(failedCall(3, "no")).toEqual({ jsonrpc: "2.0", id: 3, error: { code: -32000, message: "no" } });
  });
});
