/**
 * `--health`, the line a daily timer reads: one per workspace, and the worst
 * exit code, so a working personal workspace never masks a dead work one.
 */
import { PERMANENT, TRANSIENT } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { runHealthCheck } from "../src/cli/health.js";
import { json, notionError, row, tokensDir, withFetch } from "./helpers.js";

const me = (workspace: string) => json({ object: "user", id: "bot", name: "Example Integration", type: "bot", bot: { workspace_name: workspace } });
const searched = (results: unknown[]) => json({ object: "list", results, next_cursor: null, has_more: false });

/** Notion as each token sees it. */
const notion = (answers: Record<string, "ok" | "empty" | "revoked">) =>
  withFetch((url, init) => {
    const token = ((init?.headers as Record<string, string>)["Authorization"] ?? "").replace("Bearer ntn_", "");
    const state = answers[token];
    if (state === "revoked") return notionError(401, "unauthorized", "API token is invalid.");
    if (url.endsWith("/users/me")) return me(token === "work" ? "Example Co" : "Personal");
    return searched(state === "empty" ? [] : [row()]);
  });

const run = async (env: NodeJS.ProcessEnv) => {
  const lines: string[] = [];
  const code = await runHealthCheck((l) => lines.push(l), env);
  return { code, lines };
};

describe("--health", () => {
  it("says ok per workspace", async () => {
    notion({ personal: "ok", work: "ok" });
    const { code, lines } = await run({ NOTION_TOKENS_DIR: tokensDir({ personal: "ntn_personal", work: "ntn_work" }) });
    expect(code).toBe(0);
    expect(lines).toEqual(['NOTION: ok account=personal workspace="Personal"', 'NOTION: ok account=work workspace="Example Co"']);
  });

  it("fails on a revoked token, with the remedy, whatever the other workspace says", async () => {
    notion({ personal: "ok", work: "revoked" });
    const { code, lines } = await run({ NOTION_TOKENS_DIR: tokensDir({ personal: "ntn_personal", work: "ntn_work" }) });
    expect(code).toBe(PERMANENT);
    expect(lines[1]).toMatch(/^NOTION: FAIL account=work API token is invalid\. -- the token of "work" was refused/);
  });

  it("warns when an integration sees nothing yet", async () => {
    notion({ work: "empty" });
    const { code, lines } = await run({ NOTION_TOKENS_DIR: tokensDir({ work: "ntn_work" }) });
    expect(code).toBe(TRANSIENT);
    expect(lines[0]).toContain("share the workspace's top-level pages");
  });

  it("fails when no directory is named, naming the variable", async () => {
    const { code, lines } = await run({});
    expect(code).toBe(PERMANENT);
    expect(lines[0]).toMatch(/^NOTION: FAIL NOTION_TOKENS_DIR is not set/);
  });
});
