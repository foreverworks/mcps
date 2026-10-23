/**
 * The server as a client sees it, through the kit's guard, against an
 * in-memory System One: no key, no network.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPolicy, connectInMemory, guard, inputFilesWith, McpServer, sha256Of } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import type { Deps, SystemOnePort } from "../src/app/ports.js";
import { buildDeps } from "../src/composition.js";
import { fail } from "../src/domain/errors.js";
import type { Answer, AskRequest } from "../src/domain/schema.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";

/** Answers from the state's text: "urgent" in it is a yes, "billing" in it picks billing. */
const fakeSystemOne = (over: Partial<SystemOnePort> = {}) => {
  const asked: AskRequest[] = [];
  const port: SystemOnePort = {
    ask: async (request) => {
      asked.push(request);
      const text = JSON.stringify(request.state);
      if (text.includes("boom")) return fail({ kind: "api", status: 500, message: "TypeSafe failed" });
      const answers = Object.fromEntries(
        Object.entries(request.questions).map(([id, q]): [string, Answer] => {
          switch (q.type) {
            case "noul":
              return [id, { type: "noul", noul: text.includes("urgent") ? 0.9512 : 0.1 }];
            case "choice": {
              const pick = text.includes("billing") ? "billing" : "technical";
              return [id, { type: "choice", choice: pick, confidence: 0.8, probabilities: { billing: pick === "billing" ? 0.9 : 0.1, technical: pick === "billing" ? 0.1 : 0.9 } }];
            }
            case "score":
              return [id, { type: "score", score: 1.0512, confidence: 0.92, legend: { "0": "Calm", "1": "Frustrated", "2": "Angry" }, probabilities: { "0": 0, "1": 0.95, "2": 0.05 } }];
          }
        }),
      );
      return { model: "jev-1.13.0", answers, usage: { input_tokens: 300, output_tokens: 20 } };
    },
    models: async () => [{ name: "jev-latest", description: "the newest Jev", release_date: "2026-09-01" }],
    ...over,
  };
  return { port, asked };
};

const QUESTIONS = {
  urgent: { type: "noul", instructions: "Does this convey urgency?" },
  team: { type: "choice", instructions: "Which team should handle this?", criteria: { billing: "Payments", technical: "Bugs" } },
  mood: { type: "score", instructions: "How frustrated is the customer?", criteria: ["Calm", "Frustrated", "Angry"] },
};

/** The folder a test's files go in; also the reader's one root, so the snapshot names a fixed path. */
const INBOX = "/srv/typesafe-inbox";

const connected = async (over: Partial<SystemOnePort> = {}, inbox = INBOX) => {
  const { port, asked } = fakeSystemOne(over);
  const saved: { name: string; text: string }[] = [];
  let clock = 1_790_000_000_000;
  const deps: Deps = {
    systemOne: port,
    outbox: {
      save: async (name, text) => (saved.push({ name, text }), { path: `/srv/typesafe-outbox/${name}`, sha256: sha256Of(Buffer.from(text)), size: Buffer.byteLength(text) }),
    },
    readInput: inputFilesWith([inbox]),
    defaultModel: "jev-latest",
    baseUrl: "https://api.typesafe.ai",
    now: () => (clock += 250),
  };
  const server = new McpServer({ name: "typesafe", version: "test" });
  registerAll(guard(server, { service: "typesafe", policy: POLICY, log: () => undefined }), deps);
  const client = await connectInMemory(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return JSON.parse(result.content[0]?.text ?? "{}");
  };
  return { call, asked, saved, client };
};

describe("the typesafe tools", () => {
  it("asks every question in one request, with the default model, and drops the score legend", async () => {
    const { call, asked } = await connected();
    const answer = await call("ask", { state: "Help! Payouts failing, urgent, billing", questions: QUESTIONS });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.model).toBe("jev-latest");
    expect(answer.answers.urgent).toEqual({ type: "noul", noul: 0.9512 });
    expect(answer.answers.team).toMatchObject({ choice: "billing", confidence: 0.8 });
    expect(answer.answers.mood).toEqual({ type: "score", score: 1.0512, confidence: 0.92, probabilities: { "0": 0, "1": 0.95, "2": 0.05 } });
    expect(answer.usage).toEqual({ input_tokens: 300, output_tokens: 20 });
  });

  it("refuses a choice with one option before anything is sent", async () => {
    const { client, asked } = await connected();
    const result = (await client.callTool({
      name: "ask",
      arguments: { state: "x", questions: { one: { type: "choice", instructions: "Pick", criteria: { only: null } } } },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("2 to 255 options");
    expect(asked).toHaveLength(0);
  });

  it("refuses a null state before anything is sent: TypeSafe reads it as no state", async () => {
    const { client, asked } = await connected();
    const result = (await client.callTool({
      name: "ask",
      arguments: { state: null, questions: { one: { type: "noul", instructions: "Is it urgent?" } } },
    })) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(asked).toHaveLength(0);
  });

  it("summarises a batch, lists compact rows, and keeps going past a failed row", async () => {
    const { call } = await connected();
    const batch = await call("ask_batch", {
      items: [{ id: "a", state: "urgent billing" }, { id: "b", state: "calm bug report" }, { state: "boom" }],
      questions: QUESTIONS,
    });
    expect(batch).toMatchObject({ items: 3, answered: 2, failed: 1, models: ["jev-1.13.0"], usage: { input_tokens: 600, output_tokens: 40 } });
    expect(batch.summary).toEqual({
      urgent: { type: "noul", answered: 2, mean: 0.526, yes: 1, no: 1, between: 0 },
      team: { type: "choice", answered: 2, counts: { billing: 1, technical: 1 } },
      mood: { type: "score", answered: 2, mean: 1.051, min: 1.051, max: 1.051 },
    });
    expect(batch.results[0]).toEqual({ id: "a", answers: { urgent: 0.951, team: { choice: "billing", confidence: 0.8 }, mood: { score: 1.051, confidence: 0.92 } } });
    expect(batch.results[2]).toMatchObject({ id: "2", error: { kind: "api" } });
    expect(batch.saved).toBeUndefined();
  });

  it("saves full rows to the outbox and lists only the failures when asked", async () => {
    const { call, saved } = await connected();
    const batch = await call("ask_batch", { items: [{ state: "urgent" }, { state: "boom" }], questions: QUESTIONS, list: "failed", save: true });
    expect(batch.results).toEqual([{ id: "1", error: { kind: "api", message: "TypeSafe failed" } }]);
    expect(batch.saved.path).toMatch(/^\/srv\/typesafe-outbox\/batch-.*\.jsonl$/);
    expect(batch.saved).toMatchObject({ sha256: sha256Of(Buffer.from(saved[0]?.text ?? "")), size: Buffer.byteLength(saved[0]?.text ?? "") });
    const lines = saved[0]?.text.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines?.[0]).toMatchObject({ id: "0", model: "jev-1.13.0", answers: { mood: { legend: { "0": "Calm" } } } });
    expect(lines?.[1]).toMatchObject({ id: "1", error: { kind: "api" } });
  });

  it("stops a batch on a refused key instead of sending every row", async () => {
    let calls = 0;
    const { call } = await connected({
      ask: async () => {
        calls += 1;
        return fail({ kind: "auth", status: 401, message: "TypeSafe rejected POST" });
      },
    });
    const refused = await call("ask_batch", { items: Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, state: `row ${i}` })), questions: QUESTIONS, concurrency: 2 });
    expect(refused.error).toMatchObject({ kind: "auth", remedy: expect.stringContaining("console.typesafe.ai/keys") });
    expect(calls).toBeLessThanOrEqual(2);
  });

  it("takes the rows from a file by path, JSONL or a JSON array, and names the file it read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "typesafe-inbox-"));
    const jsonl = '{"id": "a", "state": "urgent billing"}\n\n{"state": {"subject": "calm bug report"}}\n';
    await writeFile(join(dir, "rows.jsonl"), jsonl);
    await writeFile(join(dir, "rows.json"), JSON.stringify([{ id: "x", state: "urgent" }]));
    const { call, asked } = await connected({}, dir);
    const batch = await call("ask_batch", { items_file: { path: "rows.jsonl" }, questions: QUESTIONS });
    expect(batch).toMatchObject({ itemsFile: { sha256: sha256Of(Buffer.from(jsonl)), size: Buffer.byteLength(jsonl) }, items: 2, answered: 2 });
    expect(batch.results.map((r: { id: string }) => r.id)).toEqual(["a", "1"]);
    expect(asked[1]?.state).toEqual({ subject: "calm bug report" });
    expect(await call("ask_batch", { items_file: { path: join(dir, "rows.json") }, questions: QUESTIONS })).toMatchObject({ items: 1, answered: 1 });
  });

  it("refuses a file whose bytes are not the ones hashed, and rows given two ways, before anything is sent", async () => {
    const { call, asked } = await connected();
    const text = '{"state": "urgent"}\n';
    const typo = Buffer.from(text.replace("urgent", "urgnet")).toString("base64");
    const changed = await call("ask_batch", { items_file: { content_base64: typo, sha256: sha256Of(Buffer.from(text)) }, questions: QUESTIONS });
    expect(changed.error).toMatchObject({ kind: "checksum_mismatch" });
    const both = await call("ask_batch", { items: [{ state: "a" }], items_file: { path: "rows.jsonl" }, questions: QUESTIONS });
    expect(both.error).toMatchObject({ kind: "input", message: expect.stringContaining("one way") });
    const ok = await call("ask_batch", { items_file: { content_base64: Buffer.from(text).toString("base64"), sha256: sha256Of(Buffer.from(text)) }, questions: QUESTIONS });
    expect(ok).toMatchObject({ items: 1, answered: 1 });
    expect(asked).toHaveLength(1);
  });

  it("refuses more than 20 rows unless every one has an id, before anything is sent", async () => {
    const { call, asked } = await connected();
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: `r${i}`, state: `row ${i}` }));
    const refused = await call("ask_batch", { items: [...rows.slice(0, 20), { state: "row 20" }], questions: QUESTIONS });
    expect(refused.error).toMatchObject({ kind: "input", message: expect.stringContaining("row 20 has no id") });
    expect(asked).toHaveLength(0);
    expect(await call("ask_batch", { items: rows, questions: QUESTIONS, list: "none" })).toMatchObject({ items: 21, answered: 21 });
  });

  it("refuses duplicate row ids", async () => {
    const { call, asked } = await connected();
    const refused = await call("ask_batch", { items: [{ id: "x", state: "a" }, { id: "x", state: "b" }], questions: QUESTIONS });
    expect(refused.error).toMatchObject({ kind: "input" });
    expect(asked).toHaveLength(0);
  });

  it("reports health with the models the key can use", async () => {
    const { call } = await connected();
    expect(await call("health")).toEqual({
      ok: true,
      api: "https://api.typesafe.ai",
      defaultModel: "jev-latest",
      models: [{ name: "jev-latest", released: "2026-09-01" }],
    });
  });

  it("lists the same tools, arguments and descriptions as the snapshot", async () => {
    const { client } = await connected();
    const { tools } = await client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
  });

  it("classifies every tool it registers, and nothing else", () => {
    const deps = buildDeps({});
    expect(() => checkPolicy("typesafe", (server) => registerAll(server, deps), POLICY)).not.toThrow();
  });
});

describe("ask_batch verdicts and filters", () => {
  const ROWS = [
    { id: "r1", state: "urgent billing" },
    { id: "r2", state: "urgent bug" },
    { id: "r3", state: "calm billing" },
    { id: "r4", state: "calm bug" },
  ];
  const THRESHOLDS = { urgent: { act_above: 0.85, review_above: 0.5 }, team: { act_above: 0.8, review_above: 0.79 } };

  it("gives each thresholded answer a verdict on its certainty, echoes the thresholds and counts the verdicts", async () => {
    const { call } = await connected();
    const batch = await call("ask_batch", { items: [ROWS[0], ROWS[3], { id: "x", state: "boom" }], questions: QUESTIONS, thresholds: THRESHOLDS });
    expect(batch.thresholds).toEqual(THRESHOLDS);
    expect(batch.summary.urgent).toMatchObject({ yes: 1, no: 1, verdicts: { act: 1, review: 1, abstain: 0 } });
    // A confidence of 0.8 is not above act_above 0.8: the gate is strict.
    expect(batch.summary.team).toMatchObject({ verdicts: { act: 0, review: 2, abstain: 0 } });
    expect(batch.summary.mood.verdicts).toBeUndefined();
    expect(batch.results[0]).toEqual({
      id: "r1",
      answers: {
        urgent: { noul: 0.951, certainty: 0.902, verdict: "act" },
        team: { choice: "billing", confidence: 0.8, verdict: "review" },
        mood: { score: 1.051, confidence: 0.92 },
      },
    });
    // p 0.1 is as sure a no as p 0.9 is a yes: certainty 0.8.
    expect(batch.results[1].answers.urgent).toEqual({ noul: 0.1, certainty: 0.8, verdict: "review" });
    expect(batch.results[2]).toMatchObject({ id: "x", error: { kind: "api" } });
  });

  it("saves each row's verdicts with its full answers", async () => {
    const { call, saved } = await connected();
    await call("ask_batch", { items: [ROWS[0]], questions: QUESTIONS, thresholds: { urgent: THRESHOLDS.urgent }, save: true, list: "none" });
    expect(JSON.parse(saved[0]?.text.trim() ?? "{}")).toMatchObject({ id: "r1", verdicts: { urgent: "act" } });
  });

  it("lists only the rows where keeps, the top k of them, and counts what it kept", async () => {
    const { call } = await connected();
    const ids = (b: { results: { id: string }[] }) => b.results.map((r) => r.id);
    const urgent = await call("ask_batch", { items: ROWS, questions: QUESTIONS, where: { urgent: true } });
    expect(urgent).toMatchObject({ answered: 4, matched: 2 });
    expect(ids(urgent)).toEqual(["r1", "r2"]);
    expect(urgent.summary.urgent).toMatchObject({ answered: 4, yes: 2, no: 2 });
    expect(ids(await call("ask_batch", { items: ROWS, questions: QUESTIONS, where: { team: "billing", urgent: false } }))).toEqual(["r3"]);
    expect(ids(await call("ask_batch", { items: ROWS, questions: QUESTIONS, where: { team: ["billing", "technical"], mood: { min: 1, max: 1.1 } } }))).toEqual(["r1", "r2", "r3", "r4"]);
    expect(ids(await call("ask_batch", { items: ROWS, questions: QUESTIONS, thresholds: THRESHOLDS, where: { urgent: { verdict: "act" } } }))).toEqual(["r1", "r2"]);
    expect(ids(await call("ask_batch", { items: ROWS, questions: QUESTIONS, where: { urgent: { min: 0.5 } } }))).toEqual(["r1", "r2"]);
    const best = await call("ask_batch", { items: ROWS, questions: QUESTIONS, where: { team: "technical" }, top: { by: "urgent", k: 1 } });
    expect(ids(best)).toEqual(["r2"]);
    const counted = await call("ask_batch", { items: ROWS, questions: QUESTIONS, thresholds: THRESHOLDS, where: { team: "billing" }, counts: true, list: "none" });
    expect(counted.results).toBeUndefined();
    expect(counted).toMatchObject({ matched: 2 });
    expect(counted.counts).toEqual({
      urgent: { type: "noul", yes: 1, no: 1, between: 0, verdicts: { act: 1, review: 1, abstain: 0 } },
      team: { type: "choice", counts: { billing: 2 }, verdicts: { act: 0, review: 2, abstain: 0 } },
      mood: { type: "score", levels: { "1": 2 } },
    });
  });

  it("keeps a failed row in the listing beside the rows where keeps", async () => {
    const { call } = await connected();
    const batch = await call("ask_batch", { items: [...ROWS, { id: "x", state: "boom" }], questions: QUESTIONS, where: { urgent: true } });
    expect(batch.results.map((r: { id: string }) => r.id)).toEqual(["r1", "r2", "x"]);
  });

  it("refuses thresholds, where and top that do not fit the questions, before anything is sent", async () => {
    const { call, asked } = await connected();
    const refused = async (args: Record<string, unknown>) => (await call("ask_batch", { items: ROWS, questions: QUESTIONS, ...args })).error;
    expect(await refused({ thresholds: { nope: { act_above: 0.9, review_above: 0.5 } } })).toMatchObject({ kind: "input", message: expect.stringContaining('"nope"') });
    expect(await refused({ thresholds: { urgent: { act_above: 0.5, review_above: 0.9 } } })).toMatchObject({ kind: "input" });
    expect(await refused({ where: { team: "sales" } })).toMatchObject({ kind: "input", message: expect.stringContaining("billing, technical") });
    expect(await refused({ where: { urgent: "yes" } })).toMatchObject({ kind: "input" });
    expect(await refused({ where: { mood: true } })).toMatchObject({ kind: "input" });
    expect(await refused({ where: { urgent: { verdict: "act" } } })).toMatchObject({ kind: "input", message: expect.stringContaining("no thresholds") });
    expect(await refused({ where: { urgent: { min: 0.9, max: 0.1 } } })).toMatchObject({ kind: "input" });
    expect(await refused({ top: { by: "team", k: 2 } })).toMatchObject({ kind: "input" });
    expect(await refused({ where: { urgent: true }, list: "failed" })).toMatchObject({ kind: "input" });
    expect(asked).toHaveLength(0);
  });
});

describe("ask_batch, as a long call", () => {
  it("tells a client that asked how many rows are done, ending at every row", async () => {
    const { client } = await connected();
    const heard: { progress: number; total?: number | undefined; message?: string | undefined }[] = [];
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, state: `row ${i}` }));
    const result = (await client.callTool({ name: "ask_batch", arguments: { items, questions: QUESTIONS, list: "none" } }, { onprogress: (p) => void heard.push(p) })) as {
      content: { text: string }[];
    };
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({ items: 5, answered: 5 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(heard[0]).toEqual({ progress: 1, total: 5, message: "1 of 5 rows" });
    expect(heard.at(-1)).toEqual({ progress: 5, total: 5, message: "5 of 5 rows" });
  });
});
