/**
 * The HTTP layer against a stubbed fetch: Notion's policy on the kit's client,
 * through the real accounts (token files in a temp dir) and the real endpoints.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeThrottle } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { NOTION_VERSION } from "../src/infra/http.js";
import { NOTION_FREE } from "../src/infra/http/throttle.js";
import { loadTokens } from "../src/infra/tokens.js";
import { errorOf, ID, json, notionError, row, tokensDir, withFetch } from "./helpers.js";

const setup = (tokens: Record<string, string> = { work: "ntn_work" }) => {
  const dir = tokensDir(tokens);
  const slept: number[] = [];
  const deps = buildDeps({ NOTION_TOKENS_DIR: dir }, { sleep: async (ms) => void slept.push(ms) });
  return { dir, deps, slept, work: deps.accounts.api("work") };
};

const markdown = (text = "# Hi") => json({ object: "page_markdown", id: ID.row, markdown: text, truncated: false, unknown_block_ids: [] });

describe("the token files", () => {
  it("are the accounts: notion-<label>, empty ones skipped, sorted", async () => {
    const dir = tokensDir({ work: "ntn_w", personal: "ntn_p", spare: "" });
    writeFileSync(join(dir, "token-agent"), "not ours");
    expect([...(await loadTokens(dir)).keys()]).toEqual(["personal", "work"]);
  });

  it("need a directory, and never fall back to one under home", async () => {
    expect(await errorOf(() => loadTokens(undefined))).toMatchObject({ kind: "config" });
    expect((await errorOf(() => buildDeps({}).accounts.labels()))?.message).toContain("NOTION_TOKENS_DIR");
  });
});

describe("Notion's HTTP policy", () => {
  it("sends the pinned version and the workspace's own token", async () => {
    const calls = withFetch(() => json(row()));
    const { work } = setup();
    await work.getPage(ID.row);
    expect(calls[0]?.url).toBe(`https://api.notion.com/v1/pages/${ID.row}`);
    expect(calls[0]?.headers).toMatchObject({ "Notion-Version": NOTION_VERSION, Authorization: "Bearer ntn_work" });
  });

  it("waits out a 429 for as long as Retry-After says, then repeats", async () => {
    let n = 0;
    withFetch(() => (n++ === 0 ? new Response(JSON.stringify({ code: "rate_limited" }), { status: 429, headers: { "Retry-After": "7" } }) : json(row())));
    const { work, slept } = setup();
    await work.getPage(ID.row);
    expect(n).toBe(2);
    expect(slept[0]).toBeGreaterThanOrEqual(7000);
  });

  it("repeats a conflict, which proves nothing happened, even for a new page", async () => {
    let n = 0;
    withFetch(() => (n++ === 0 ? notionError(409, "conflict_error") : json(row())));
    const { work } = setup();
    await work.createPage({ parent: { type: "data_source", id: ID.source }, properties: {} });
    expect(n).toBe(2);
  });

  it("never resends an append after a 5xx: it may have landed", async () => {
    const calls = withFetch(() => notionError(502, "bad_gateway"));
    const { work } = setup();
    const error = await errorOf(() => work.editContent(ID.row, { kind: "insert", markdown: "x", at: "end" }));
    expect(error).toMatchObject({ kind: "outcome_unknown", account: "work" });
    expect(calls).toHaveLength(1);
  });

  it("does resend a whole-body replace, which lands the same twice", async () => {
    let n = 0;
    withFetch(() => (n++ === 0 ? notionError(502, "bad_gateway") : markdown()));
    const { work } = setup();
    await work.editContent(ID.row, { kind: "replace", markdown: "# Hi", allowDeleting: false });
    expect(n).toBe(2);
  });

  it("after a 401, re-reads the token file once, so a replaced token works without a restart", async () => {
    let refuseOld = false;
    const calls = withFetch((_url, init) =>
      refuseOld && (init?.headers as Record<string, string>)["Authorization"] === "Bearer ntn_old" ? notionError(401, "unauthorized") : json(row()),
    );
    const { dir, work } = setup({ work: "ntn_old" });
    await work.getPage(ID.row);
    writeFileSync(join(dir, "notion-work"), "ntn_new");
    refuseOld = true;
    await work.getPage(ID.row);
    expect(calls.map((c) => c.headers["Authorization"])).toEqual(["Bearer ntn_old", "Bearer ntn_old", "Bearer ntn_new"]);
  });

  it("turns each refusal into this server's failure, naming the workspace", async () => {
    const { work } = setup();
    withFetch(() => notionError(401, "unauthorized", "API token is invalid."));
    expect(await errorOf(() => work.me())).toMatchObject({ kind: "auth", account: "work", message: "API token is invalid." });
    withFetch(() => notionError(404, "object_not_found"));
    expect(await errorOf(() => work.getPage(ID.row))).toMatchObject({ kind: "not_shared", accounts: ["work"] });
    withFetch(() => notionError(403, "restricted_resource"));
    expect(await errorOf(() => work.getPage(ID.row))).toMatchObject({ kind: "forbidden", account: "work" });
    withFetch(() => notionError(400, "validation_error", "body.properties.Status should be ..."));
    expect(await errorOf(() => work.getPage(ID.row))).toMatchObject({ kind: "input", code: "validation_error" });
  });

  it("asks for columns by their plain ids, whatever encoding Notion gave them", async () => {
    const calls = withFetch(() => json({ object: "list", results: [], next_cursor: null, has_more: false }));
    const { work } = setup();
    await work.query(ID.source, { sorts: [], propertyIds: ["title", "st%3A1"], pageSize: 10, inTrash: false });
    expect(calls[0]?.url).toBe(`https://api.notion.com/v1/data_sources/${ID.source}/query?filter_properties=title&filter_properties=st%3A1`);
    expect(calls[0]?.body).toEqual({ page_size: 10, result_type: "page" });
  });
});

describe("the throttle", () => {
  it("admits 30 at once, then never more than 180 in any minute, and not much fewer", async () => {
    let now = 0;
    const admitted: number[] = [];
    const throttle = makeThrottle(NOTION_FREE, { now: () => now, sleep: async (ms) => void (now += ms) });
    for (let i = 0; i < 400; i += 1) await throttle(async () => void admitted.push(now));
    expect(admitted.filter((t) => t === 0)).toHaveLength(30);
    const busiest = Math.max(...admitted.map((t) => admitted.filter((u) => u >= t && u < t + 60_000).length));
    expect(busiest).toBeLessThanOrEqual(180);
    // 370 after the burst at 2.5 a second is 148 s; the whole-second waits cost at most one more.
    expect(admitted.at(-1)).toBeLessThanOrEqual(149_000);
  });
});

describe("template catalog", () => {
  it("uses the data-source endpoint and forwards pagination", async () => {
    const calls = withFetch(() => json({ templates: [], has_more: false, next_cursor: null }));
    await setup().work.listTemplates(ID.source, 10, ID.row);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe(`/v1/data_sources/${ID.source}/templates`);
    expect(url.searchParams.get("page_size")).toBe("10");
    expect(url.searchParams.get("start_cursor")).toBe(ID.row);
  });
});
