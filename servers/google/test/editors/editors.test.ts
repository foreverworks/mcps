/**
 * The grants Docs, Sheets and Slides share, the health check over them, and
 * the three adapters' requests as they go on the wire. Every root is a temp
 * dir and fetch is stubbed: nothing here can reach a real grant.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { makeDocsApi } from "../../src/docs/infra/docsApi.js";
import { buildDeps as buildDrive, buildGrant } from "../../src/drive/composition.js";
import { checkHealth } from "../../src/editors/app/health.js";
import type { HealthDeps } from "../../src/editors/app/ports.js";
import { buildEditors } from "../../src/editors/composition.js";
import { apiError, asAppError, fail } from "../../src/editors/domain/errors.js";
import { DRIVE, NARROW_SCOPES } from "../../src/editors/domain/grants.js";
import { fileIdFrom } from "../../src/editors/domain/ids.js";
import { makeProbe } from "../../src/editors/infra/probe.js";
import { makeRequest } from "../../src/infra/httpJson.js";
import { makeSheetsApi } from "../../src/sheets/infra/sheetsApi.js";
import { makeSlidesApi } from "../../src/slides/infra/slidesApi.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "editors-"));

const grantDir = (root: string, label: string, account?: string): void => {
  mkdirSync(join(root, label), { recursive: true });
  writeFileSync(join(root, label, "credentials.json"), JSON.stringify({ refresh_token: "r", client_id: "c", client_secret: "s", ...(account ? { account } : {}) }));
};

const editorsWith = (env: NodeJS.ProcessEnv) => {
  const driveEnv = { DRIVE_RCLONE_CONF: join(tmp(), "none.conf"), DRIVE_STATE_DIR: tmp(), GOOGLE_EDITORS_DRIVE_ACCOUNT: "work", ...env };
  const grant = buildGrant(driveEnv);
  return buildEditors(driveEnv, { grant, drive: buildDrive(driveEnv, grant) });
};

const failureOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return asAppError(e);
  }
  throw new Error("expected a failure");
};

describe("the grant registry", () => {
  it("runs work on the Drive grant and discovers every other account on disk, the default first", () => {
    const root = tmp();
    grantDir(root, "personal", "ana@example.com");
    const editors = editorsWith({ GOOGLE_EDITORS_ROOT: root });
    expect(editors.specs().map((s) => [s.label, s.source])).toEqual([
      ["work", "drive"],
      ["personal", "credentials"],
    ]);
    expect(editors.specs()[1]).toMatchObject({ address: "ana@example.com", stateDir: join(root, "personal", "state") });
    expect(editors.account("").label).toBe("work");
  });

  it("answers an account with no grant with the remedy, naming where the file goes", () => {
    const root = tmp();
    const editors = editorsWith({ GOOGLE_EDITORS_ROOT: root });
    expect(failureOf(() => editors.account("personal"))).toMatchObject({
      kind: "config",
      message: expect.stringContaining(`${root}/personal/credentials.json`),
    });
  });

  it("picks up a grant written after start, on the next call", () => {
    const root = tmp();
    const editors = editorsWith({ GOOGLE_EDITORS_ROOT: root });
    expect(failureOf(() => editors.account("personal"))).toMatchObject({ kind: "config" });
    grantDir(root, "personal");
    expect(editors.account("personal")).toMatchObject({ label: "personal", source: "credentials" });
  });

  it("lets a work directory replace the Drive fallback, moves token caches with the state root, and can drop the fallback", () => {
    const root = tmp();
    const state = tmp();
    grantDir(root, "work");
    const moved = editorsWith({ GOOGLE_EDITORS_ROOT: root, GOOGLE_EDITORS_STATE_DIR: state });
    expect(moved.specs()).toEqual([expect.objectContaining({ label: "work", source: "credentials", stateDir: join(state, "work") })]);
    expect(editorsWith({ GOOGLE_EDITORS_ROOT: tmp(), GOOGLE_EDITORS_DRIVE_ACCOUNT: "" }).specs()).toEqual([]);
    expect(editorsWith({ GOOGLE_EDITORS_ROOT: tmp(), GOOGLE_EDITORS_DRIVE_ACCOUNT: undefined }).specs()).toEqual([]);
  });

  it("refuses a label that could walk out of the root, and '*'", () => {
    const editors = editorsWith({ GOOGLE_EDITORS_ROOT: tmp() });
    expect(failureOf(() => editors.account("../gmail"))).toMatchObject({ kind: "config", message: expect.stringMatching(/not an account label/) });
    expect(failureOf(() => editors.account("*"))).toMatchObject({ kind: "config" });
  });

  it("builds an account once and keeps it, token cache and all", () => {
    const editors = editorsWith({ GOOGLE_EDITORS_ROOT: tmp() });
    expect(editors.account("work")).toBe(editors.account("work"));
  });
});

describe("health", () => {
  const deps = (over: Partial<HealthDeps>): HealthDeps => ({
    account: "work",
    source: "drive",
    detail: "the Drive grant",
    scopes: async () => [DRIVE],
    whoami: async () => "ana@work.example",
    probe: async () => undefined,
    ...over,
  });

  it("is ok when the scope covers all three APIs and each answers", async () => {
    expect(await checkHealth(deps({}))).toMatchObject({ ok: true, missingScopes: [], apis: { docs: "enabled", sheets: "enabled", slides: "enabled" } });
  });

  it("names an API the Cloud project has not enabled", async () => {
    const health = await checkHealth(
      deps({ probe: async (api) => (api === "slides" ? fail(apiError(403, "disabled", { reason: "SERVICE_DISABLED" })) : undefined) }),
    );
    expect(health).toMatchObject({ ok: false, apis: { docs: "enabled", slides: "disabled" } });
  });

  it("fails narrow scopes with one missing, and a grant resolving to another address", async () => {
    expect(await checkHealth(deps({ scopes: async () => NARROW_SCOPES.slice(0, 3) }))).toMatchObject({
      ok: false,
      missingScopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    expect(await checkHealth(deps({ address: "ana@example.com" }))).toMatchObject({ ok: false, addressMatches: false });
  });
});

describe("on the wire", () => {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const answer = (status: number, body: unknown) => {
    vi.stubGlobal("fetch", async (url: string, init: { method: string; body?: string }) => {
      sent.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    });
  };
  const request = () => makeRequest({ get: async () => "token", force: async () => "token" }, { sleep: async () => undefined });

  afterEach(() => {
    sent.length = 0;
    vi.unstubAllGlobals();
  });

  it("pins a Docs batch to the revision it was computed from", async () => {
    answer(200, { writeControl: { requiredRevisionId: "r2" } });
    expect(await makeDocsApi(request()).batchUpdate("doc 1", [{ insertText: { location: { index: 1 }, text: "x" } }], "r1")).toBe("r2");
    expect(sent[0]).toMatchObject({ method: "POST", url: "https://docs.googleapis.com/v1/documents/doc%201:batchUpdate", body: { writeControl: { requiredRevisionId: "r1" } } });
  });

  it("reads one sheet's grid, typed-read fields only, and writes values as typed", async () => {
    answer(200, {});
    const sheets = makeSheetsApi(request());
    await sheets.grid("S1", "Q3 '24");
    const url = new URL(sent[0]?.url ?? "");
    expect(url.searchParams.get("ranges")).toBe("'Q3 ''24'");
    expect(url.searchParams.get("includeGridData")).toBe("true");
    expect(url.searchParams.get("fields")).toContain("effectiveFormat/numberFormat");
    await sheets.writeValues("S1", "Sheet1!A1:B2", [[1, "=A1*2"]]);
    expect(sent[1]).toMatchObject({ method: "PUT", url: expect.stringContaining("/values/Sheet1!A1%3AB2?valueInputOption=USER_ENTERED") });
  });

  it("asks Slides for a PNG thumbnail of one page at the size given", async () => {
    answer(200, { contentUrl: "https://x", width: 800, height: 450 });
    await makeSlidesApi(request()).thumbnail("P", "p1", "LARGE");
    const url = new URL(sent[0]?.url ?? "");
    expect(url.pathname).toBe("/v1/presentations/P/pages/p1/thumbnail");
    expect([url.searchParams.get("thumbnailProperties.mimeType"), url.searchParams.get("thumbnailProperties.thumbnailSize")]).toEqual(["PNG", "LARGE"]);
  });

  it("probes: a 404 from the API means it answers; SERVICE_DISABLED in the newer error shape means it is off", async () => {
    answer(404, { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } });
    await expect(makeProbe(() => request())("docs")).resolves.toBeUndefined();
    answer(403, {
      error: { code: 403, status: "PERMISSION_DENIED", message: "Google Sheets API has not been used", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" }] },
    });
    const thrown = await makeProbe(() => request())("sheets").catch((e: unknown) => e);
    expect(asAppError(thrown)).toMatchObject({ kind: "api", status: 403, reason: "SERVICE_DISABLED" });
  });
});

describe("file ids", () => {
  it("takes an id or the URL a file opens at", () => {
    expect(fileIdFrom("https://docs.google.com/spreadsheets/d/1AbC-_x/edit#gid=0")).toBe("1AbC-_x");
    expect(fileIdFrom(" 1AbC ")).toBe("1AbC");
  });

  it("refuses what is neither, before any request", () => {
    expect(failureOf(() => fileIdFrom("../1AbC"))).toMatchObject({ kind: "input" });
    expect(failureOf(() => fileIdFrom("1AbC?alt=media"))).toMatchObject({ kind: "input" });
  });
});
