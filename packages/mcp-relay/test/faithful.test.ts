import { chmod, mkdir, readdir, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fakeUpstream, relayTo, relayToken, sha256, type Seen } from "./harness.js";

/** Numbers a program that reads JSON and writes it again would change: a trailing zero, a big integer, exponents, a negative zero, digits a double cannot hold. */
const NUMBERS = '"total":12.50,"id":9007199254740993,"big":1e3,"small":1E-7,"neg":-0.0,"long":0.1000000000000000055511151231257827';

const post = (url: string, body: string): Promise<Response> =>
  fetch(url, { method: "POST", headers: { authorization: `Bearer ${relayToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body });

const json = (res: import("node:http").ServerResponse, status: number, text: string): void => {
  res.writeHead(status, { "content-type": "application/json" }).end(text);
};

const OK_FILE = "ok.txt";
const okBytes = "a file the relay brings";
const serveFiles = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean => {
  if (!req.url?.startsWith("/files/outbox/")) return false;
  if (req.url === `/files/outbox/${OK_FILE}`) res.writeHead(200, { "content-length": String(okBytes.length), "x-content-sha256": sha256(okBytes) }).end(okBytes);
  else res.writeHead(404).end("not found\n");
  return true;
};

/** The text of an answer with the note item the relay added taken out, which leaves what the upstream said. */
const withoutNote = (text: string): { readonly rest: string; readonly note: string } => {
  const found = /,\{"type":"text","text":"The relay could not bring[^]*?"\}(?=\s*\])/.exec(text);
  return found === null ? { rest: text, note: "" } : { rest: text.replace(found[0], ""), note: JSON.parse(found[0].slice(1)).text as string };
};

describe("what the relay passes on, it passes on as it was written", () => {
  const answerText = (out: string, files: readonly string[]): string =>
    `{ "jsonrpc":"2.0", "id":9007199254740993, "result":{"content":[{"type":"text","text":"ok"},${files.map((f) => `{"type":"resource_link","uri":"file://${out}/${f}","name":"${f}"}`).join(",")}],"structuredContent":{${NUMBERS}}} }\n`;

  const withAnswer = async (make: (out: string) => string) => {
    let out = "";
    const upstream = await fakeUpstream((req, res) => {
      if (serveFiles(req, res)) return;
      json(res, 200, make(out));
    });
    const relay = await relayTo(upstream.url);
    out = relay.localOut;
    return { upstream, relay, done: async () => { await relay.close(); await upstream.close(); } };
  };

  it("an answer, byte for byte, when nothing is added: the files it links were brought over", async () => {
    const run = await withAnswer((out) => answerText(out, [OK_FILE]));
    try {
      const answer = await post(run.relay.url, '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{}}}');
      expect(await answer.text()).toBe(answerText(run.relay.localOut, [OK_FILE]));
      expect(answer.headers.get("content-type")).toBe("application/json");
      expect(await readdir(run.relay.localOut)).toEqual([OK_FILE]);
    } finally {
      await run.done();
    }
  });

  it("an answer with nothing to fetch, byte for byte", async () => {
    const text = answerText("/nowhere", []).replace('"name":"ok"}', '"name":"ok"}');
    const run = await withAnswer(() => text);
    try {
      expect(await (await post(run.relay.url, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')).text()).toBe(text);
    } finally {
      await run.done();
    }
  });

  it("an answer with a note added, the note and nothing else", async () => {
    const run = await withAnswer((out) => answerText(out, [OK_FILE, "missing.txt"]));
    try {
      const text = await (await post(run.relay.url, '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{}}}')).text();
      const { rest, note } = withoutNote(text);
      expect(rest).toBe(answerText(run.relay.localOut, [OK_FILE, "missing.txt"]));
      expect(note).toContain(join(run.relay.localOut, "missing.txt"));
      expect(note).toMatch(/404/);
      // The numbers are the digits that were written.
      for (const digits of ["12.50", "9007199254740993", "1e3", "1E-7", "-0.0", "0.1000000000000000055511151231257827"]) expect(text).toContain(digits);
      expect(JSON.parse(text).result.content).toHaveLength(4);
    } finally {
      await run.done();
    }
  });

  it("each answer of a batch, and only the one that needs a note gets one", async () => {
    const run = await withAnswer((out) => `[${answerText(out, [OK_FILE]).trim()}, ${answerText(out, ["missing.txt"]).trim().replace("9007199254740993", "9007199254740995")}]`);
    try {
      const text = await (await post(run.relay.url, '[{"jsonrpc":"2.0","id":1,"method":"tools/list"},{"jsonrpc":"2.0","id":2,"method":"tools/list"}]')).text();
      const out = run.relay.localOut;
      const { rest, note } = withoutNote(text);
      expect(rest).toBe(`[${answerText(out, [OK_FILE]).trim()}, ${answerText(out, ["missing.txt"]).trim().replace("9007199254740993", "9007199254740995")}]`);
      expect(note).toContain("missing.txt");
      expect(text.match(/The relay could not bring/g)).toHaveLength(1);
    } finally {
      await run.done();
    }
  });

  it("the events of a stream, byte for byte, and a note spliced into the event that needs one", async () => {
    let out = "";
    const progress = `id: 1\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":12.50,"total":1e3,"token":9007199254740993}}\n\n`;
    const link = (f: string): string => `{"type":"resource_link","uri":"file://${out}/${f}","name":"${f}"}`;
    const fine = (): string => `id: 2\r\ndata: { "jsonrpc":"2.0","id":7,"result":{"content":[${link(OK_FILE)}],"structuredContent":{${NUMBERS}}} }\r\n\r\n`;
    const needsNote = (): string => `id: 3\ndata: {"jsonrpc":"2.0","id":8,"result":{"content":[${link("missing.txt")}],"structuredContent":{${NUMBERS}}}}\n\n`;
    const upstream = await fakeUpstream((req, res) => {
      if (serveFiles(req, res)) return;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(progress + fine() + needsNote());
    });
    const relay = await relayTo(upstream.url);
    out = relay.localOut;
    try {
      const text = await (await post(relay.url, '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"x","arguments":{}}}')).text();
      expect(text.startsWith(progress + fine())).toBe(true);
      const { rest, note } = withoutNote(text);
      expect(rest).toBe(progress + fine() + needsNote());
      expect(note).toContain("missing.txt");
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});

describe("what the relay sends on, it sends on as it was written", () => {
  const call = (id: string, args: string): string => `{ "jsonrpc":"2.0",  "id":${id}, "method":"tools/call", "params":{"name":"x","arguments":${args}} }`;

  const batchTo = async (handle: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, seen: Seen) => void) => {
    const upstream = await fakeUpstream(handle);
    const relay = await relayTo(upstream.url);
    return { upstream, relay, done: async () => { await relay.close(); await upstream.close(); } };
  };

  it("the very bytes of a request that needs nothing", async () => {
    const run = await batchTo((_req, res) => json(res, 200, "{}"));
    try {
      const body = call("9007199254740993", `{"amount":12.50,"big":1e3,"note":"/etc/hostname"}`);
      await post(run.relay.url, body);
      expect(run.upstream.seen[0]?.body.toString()).toBe(body);
    } finally {
      await run.done();
    }
  });

  it("the text of the calls that go on, when another is not made, and its error under its own id", async () => {
    const run = await batchTo((req, res, seen) => {
      if (req.method === "PUT") return void res.writeHead(req.url?.includes("bad") ? 413 : 200, { "content-type": "application/json" }).end(req.url?.includes("bad") ? "no" : JSON.stringify({ path: "", size: 2, sha256: sha256("ok") }));
      json(res, 200, `[${(JSON.parse(seen.body.toString()) as { id: unknown }[]).map(() => "{}").join(",")}]`);
    });
    try {
      await writeFile(join(run.relay.localIn, "good.txt"), "ok");
      await writeFile(join(run.relay.localIn, "bad.txt"), "no");
      const first = call("9007199254740993", `{"amount":12.50,"path":"${join(run.relay.localIn, "good.txt")}"}`);
      const second = call("9007199254740995", `{"amount":1e3,"path":"${join(run.relay.localIn, "bad.txt")}"}`);
      const third = call("3", `{"n":0.30,"big":9007199254740993}`);
      const text = await (await post(run.relay.url, `[ ${first} ,\n${second},${third}\n]`)).text();
      const forwarded = run.upstream.seen.find((s) => s.method === "POST");
      expect(forwarded?.body.toString()).toBe(`[${first},${third}]`);
      expect(text).toContain('{"jsonrpc":"2.0","id":9007199254740995,"error":{"code":-32000,"message":"The relay could not send ');
      expect(text).toContain(join(run.relay.localIn, "bad.txt"));
    } finally {
      await run.done();
    }
  });

  it("the error of a call that was not made, when the upstream has nothing to say but 202 to the rest of the batch", async () => {
    const run = await batchTo((req, res) => (req.method === "PUT" ? void res.writeHead(413).end("no") : void res.writeHead(202).end()));
    try {
      await writeFile(join(run.relay.localIn, "bad.txt"), "no");
      const notification = '{"jsonrpc":"2.0","method":"notifications/initialized"}';
      const answer = await post(run.relay.url, `[${call("9007199254740995", `{"path":"${join(run.relay.localIn, "bad.txt")}"}`)},${notification}]`);
      expect(answer.status).toBe(200);
      expect(answer.headers.get("content-type")).toBe("application/json");
      const text = await answer.text();
      expect(text).toContain('"id":9007199254740995,"error":{"code":-32000');
      expect(JSON.parse(text)).toHaveLength(1);
      expect(run.upstream.seen.find((s) => s.method === "POST")?.body.toString()).toBe(`[${notification}]`);
    } finally {
      await run.done();
    }
  });
});

describe("a request target no URL parser takes", () => {
  const statusOf = (port: number, target: string): Promise<number> =>
    new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, method: "GET", path: target, headers: { authorization: `Bearer ${relayToken}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });

  it("is a 404 from the relay, which goes on serving", async () => {
    const upstream = await fakeUpstream((_req, res) => json(res, 200, "{}"));
    const relay = await relayTo(upstream.url);
    try {
      for (const target of ["//", "///", "//?x"]) expect(await statusOf(relay.relay.port, target)).toBe(404);
      expect((await post(relay.url, "{}")).status).toBe(200);
      expect(upstream.seen.map((s) => s.method)).toEqual(["POST"]);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});

describe("a file in the inbox that the relay cannot read", () => {
  const root = process.getuid?.() === 0;

  it.skipIf(root)("fails the call, naming the file and why, instead of calling it a name that was made up", async () => {
    const upstream = await fakeUpstream((_req, res) => json(res, 200, "{}"));
    const relay = await relayTo(upstream.url);
    try {
      const path = join(relay.localIn, "locked.txt");
      await writeFile(path, "private");
      await chmod(path, 0o000);
      const answer = (await (await post(relay.url, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{"path":"${path}"}}}`)).json()) as { error: { message: string } };
      expect(answer.error.message).toContain(path);
      expect(answer.error.message).toMatch(/cannot be read by the relay \(EACCES\)/);
      expect(upstream.seen).toEqual([]);
      // A folder it may not search is the same.
      await mkdir(join(relay.localIn, "closed"));
      await writeFile(join(relay.localIn, "closed", "inside.txt"), "x");
      await chmod(join(relay.localIn, "closed"), 0o000);
      const inside = (await (await post(relay.url, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"x","arguments":{"path":"${join(relay.localIn, "closed", "inside.txt")}"}}}`)).json()) as { error: { message: string } };
      expect(inside.error.message).toMatch(/cannot be read by the relay \(EACCES\)/);
      await chmod(join(relay.localIn, "closed"), 0o755);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });

  it("still lets a name that is not a file go by: the call is made", async () => {
    const upstream = await fakeUpstream((_req, res) => json(res, 200, "{}"));
    const relay = await relayTo(upstream.url);
    try {
      await mkdir(join(relay.localIn, "a-folder"));
      const body = `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{"a":"${join(relay.localIn, "nothing.txt")}","b":"${join(relay.localIn, "a-folder")}","c":"${join(relay.localIn, "nothing", "below.txt")}"}}}`;
      expect((await post(relay.url, body)).status).toBe(200);
      expect(upstream.seen.map((s) => s.method)).toEqual(["POST"]);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});

describe("a stream with an event of megabytes", () => {
  const MIB = 1024 * 1024;

  it("passes through in a moment, whole", async () => {
    const chunk = "x".repeat(16 * 1024);
    const upstream = await fakeUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: ");
      let left = (16 * MIB) / chunk.length;
      const pump = (): void => {
        while (left > 0) {
          left -= 1;
          if (!res.write(chunk)) return void res.once("drain", pump);
        }
        res.end("\n\ndata: after\n\n");
      };
      pump();
    });
    const relay = await relayTo(upstream.url);
    try {
      const started = Date.now();
      const text = await (await post(relay.url, '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{}}}')).text();
      expect(Date.now() - started).toBeLessThan(8000);
      expect(text.length).toBe("data: ".length + 16 * MIB + "\n\ndata: after\n\n".length);
      expect(text.endsWith("\n\ndata: after\n\n")).toBe(true);
    } finally {
      await relay.close();
      await upstream.close();
    }
  }, 20_000);

  it("ends where it is when an event never ends, without holding it all", async () => {
    const chunk = "y".repeat(MIB);
    let sent = 0;
    const upstream = await fakeUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      const pump = (): void => {
        while (!res.destroyed && sent < 200) {
          sent += 1;
          if (!res.write(chunk)) return void res.once("drain", pump);
        }
      };
      res.on("close", () => undefined);
      pump();
    });
    const relay = await relayTo(upstream.url);
    try {
      const started = Date.now();
      const text = await (await post(relay.url, '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{}}}')).text();
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(text).toBe("data: first\n\n");
      expect(sent).toBeLessThan(200);
      expect(relay.log.join("\n")).toMatch(/relay-warning .*without a blank line; the stream was ended there/);
    } finally {
      await relay.close();
      await upstream.close();
    }
  }, 30_000);
});

describe("a fetch that comes to nothing, in a folder it would have made", () => {
  it("leaves the outbox as it was, folders included", async () => {
    let out = "";
    const upstream = await fakeUpstream((req, res) => {
      if (req.url?.startsWith("/files/outbox/")) return void res.writeHead(200, { "content-length": "5", "x-content-sha256": sha256("other") }).end("bytes");
      json(res, 200, `{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"resource_link","uri":"file://${out}/new/deeper/f.bin","name":"f"}]}}`);
    });
    const relay = await relayTo(upstream.url);
    out = relay.localOut;
    try {
      await mkdir(join(relay.localOut, "there"));
      const text = await (await post(relay.url, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')).text();
      expect(text).toMatch(/arrived damaged/);
      expect((await readdir(relay.localOut, { recursive: true })).sort()).toEqual(["there"]);
    } finally {
      await relay.close();
      await upstream.close();
    }
  });
});
