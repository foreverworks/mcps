import { describe, expect, it } from "vitest";

import { contentEndOf, elementsOf, idSourceOf, membersOf, messageSpans, prepend, splice, textOf } from "../src/json.js";

const response = '{ "jsonrpc": "2.0", "id": 9007199254740993, "result": { "content": [ {"type":"text","text":"a ] } \\" ["}, {"n": 12.50} ], "x": 1e3 } }';

describe("finding places in JSON text", () => {
  it("lists an object's members and an array's elements where they lie, strings with brackets and quotes in them included", () => {
    const members = membersOf(response, 0) ?? [];
    expect(members.map((m) => m.key)).toEqual(["jsonrpc", "id", "result"]);
    expect(textOf(response, members[1]?.value as { start: number; end: number })).toBe("9007199254740993");
    const result = members[2]?.value as { start: number; end: number };
    const inner = membersOf(response, result.start) ?? [];
    expect(inner.map((m) => m.key)).toEqual(["content", "x"]);
    const items = elementsOf(response, (inner[0] as { value: { start: number } }).value.start) ?? [];
    expect(items.map((span) => textOf(response, span))).toEqual(['{"type":"text","text":"a ] } \\" ["}', '{"n": 12.50}']);
    expect(textOf(response, (inner[1] as { value: { start: number; end: number } }).value)).toBe("1e3");
  });

  it("takes an empty object and array, and refuses text that is not what it was pointed at", () => {
    expect(membersOf("{ }", 0)).toEqual([]);
    expect(elementsOf("[ ]", 0)).toEqual([]);
    expect(membersOf("[1]", 0)).toBeUndefined();
    expect(elementsOf("{}", 0)).toBeUndefined();
    expect(membersOf('{"a" 1}', 0)).toBeUndefined();
    expect(membersOf('{"a":1', 0)).toBeUndefined();
    expect(elementsOf("[1, 2", 0)).toBeUndefined();
    expect(elementsOf('["unterminated', 0)).toBeUndefined();
  });

  it("finds the messages of a request: one, or each of a batch", () => {
    expect(messageSpans(` ${response} `)).toEqual([{ start: 1, end: 1 + response.length }]);
    const batch = '[ {"id":1} , {"id":2.50}\n]';
    expect((messageSpans(batch) ?? []).map((span) => textOf(batch, span))).toEqual(['{"id":1}', '{"id":2.50}']);
    expect(messageSpans("[]")).toEqual([]);
    expect(messageSpans('"text"')).toBeUndefined();
    expect(messageSpans("12")).toBeUndefined();
  });

  it("reads an id as it was written, and the last one when it is written twice, as JSON.parse does", () => {
    expect(idSourceOf(response, { start: 0, end: response.length })).toBe("9007199254740993");
    const twice = '{"id":1,"id":"two"}';
    expect(idSourceOf(twice, { start: 0, end: twice.length })).toBe('"two"');
    expect(idSourceOf('{"method":"x"}', { start: 0, end: 14 })).toBeUndefined();
  });

  it("finds where an item is added to a result's content", () => {
    const place = contentEndOf(response, { start: 0, end: response.length });
    expect(place).toBeDefined();
    const added = splice(response, [{ at: (place as { at: number }).at, insert: ',{"type":"text","text":"note"}' }]);
    expect(JSON.parse(added).result.content).toHaveLength(3);
    expect(added).toBe(response.replace('{"n": 12.50} ]', '{"n": 12.50},{"type":"text","text":"note"} ]'));
    const empty = '{"result":{"content":[ ]}}';
    const first = contentEndOf(empty, { start: 0, end: empty.length }) as { at: number; after: boolean };
    expect(first.after).toBe(false);
    expect(JSON.parse(splice(empty, [{ at: first.at, insert: '{"type":"text","text":"n"}' }])).result.content).toEqual([{ type: "text", text: "n" }]);
    for (const none of ['{"result":{}}', '{"result":{"content":"x"}}', '{"error":{}}', '{"result":[]}', "{}"]) expect(contentEndOf(none, { start: 0, end: none.length })).toBeUndefined();
  });

  it("splices every insertion at its place in the original, whatever order they are given in", () => {
    expect(splice("abcdef", [{ at: 2, insert: "X" }, { at: 5, insert: "Y" }, { at: 0, insert: "Z" }])).toBe("ZabXcdeYf");
    expect(splice("abc", [])).toBe("abc");
  });

  it("puts responses in front of a batch's, or makes a batch of a single response", () => {
    expect(prepend('[ {"id":1.0} ]', ['{"id":0}'])).toBe('[{"id":0}, {"id":1.0} ]');
    expect(prepend("[]", ['{"id":0}', '{"id":9}'])).toBe('[{"id":0},{"id":9}]');
    expect(prepend('  {"id":1e2}\n', ['{"id":0}'])).toBe('[{"id":0},{"id":1e2}]');
  });
});
