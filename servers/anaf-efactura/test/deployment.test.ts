/**
 * The server as deployed, in temp dirs: paths from the environment only,
 * app.json in a read-only credentials dir, everything written in the state
 * dir, the shell modes' one line, and the policy covering every tool.
 */
import { chmodSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { connectInMemory, inputFilesWith, McpServer, registeredNames } from "@foreverworks/mcp-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { beginAuthorization, completeAuthorization } from "../src/app/usecases/authorization.js";
import { downloadInvoice } from "../src/app/usecases/invoices.js";
import { healthVerdict } from "../src/cli/health.js";
import { refreshVerdict } from "../src/cli/refresh.js";
import { buildDeps } from "../src/composition.js";
import { toStored } from "../src/domain/tokens.js";
import { WITHHELD_GREETING } from "../src/infra/anafApi/greeting.js";
import { makeFiles } from "../src/infra/files.js";
import { resolvePaths } from "../src/infra/paths.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { ARCHIVE, bundle, DAY, deployment, errorOf, json, jwt, NOW, withFetch } from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

const options = { now: () => NOW, http: { sleep: async () => undefined } };

const withTokens = (stateDir: string, over = {}) => writeFileSync(join(stateDir, "tokens.json"), JSON.stringify(toStored(bundle(over))));

const granted = () =>
  json({ access_token: jwt({ exp: NOW + 90 * DAY, roles: "EFACTURA" }), refresh_token: "SECRET-REFRESH", expires_in: 7776000 });

describe("paths", () => {
  it("have no default for app.json, and the kit's default for state", () => {
    expect(resolvePaths({ HOME: "/home/someone" })).toEqual({
      config: undefined,
      stateDir: "/home/someone/.local/state/mcps/anaf-efactura",
      tokens: "/home/someone/.local/state/mcps/anaf-efactura/tokens.json",
      downloadsDir: "/home/someone/.local/state/mcps/anaf-efactura/invoices",
    });
  });

  it("answer a missing app.json from the tool that needs it, naming the variable, not at startup", async () => {
    const deps = buildDeps({}, options);
    expect(await errorOf(() => deps.identity())).toMatchObject({
      kind: "config",
      message: "ANAF_CONFIG is not set; this server has no default location",
    });
  });

  it("put tokens.json in the state dir, always", () => {
    const paths = resolvePaths({ ANAF_CONFIG: "/creds/app.json", ANAF_STATE_DIR: "/state" });
    expect(paths).toMatchObject({ tokens: "/state/tokens.json", downloadsDir: "/state/invoices" });
  });

  it("put downloads in the outbox ANAF_DOWNLOADS_DIR names, never beside app.json", () => {
    const env = { ANAF_CONFIG: "/creds/app.json", ANAF_STATE_DIR: "/state" };
    expect(resolvePaths({ ...env, ANAF_DOWNLOADS_DIR: "/srv/outbox/anaf" }).downloadsDir).toBe("/srv/outbox/anaf");
    expect(resolvePaths({ ...env, ANAF_DOWNLOADS_DIR: "/creds/downloads" }).layoutProblem).toContain("ANAF_DOWNLOADS_DIR");
  });

  it("report any layout that writes beside app.json from every tool that reads it or writes a file", async () => {
    const env = { ANAF_CONFIG: "/creds/app.json", ANAF_STATE_DIR: "/state" };
    expect(resolvePaths({ ...env, ANAF_STATE_DIR: "/creds" }).layoutProblem).toContain("inside app.json's directory");
    expect(resolvePaths({ ...env, ANAF_STATE_DIR: "/creds/state" }).layoutProblem).toContain("inside app.json's directory");
    const deps = buildDeps({ ...env, ANAF_STATE_DIR: "/creds/state" }, options);
    expect(await errorOf(() => deps.identity())).toMatchObject({ kind: "config", message: expect.stringContaining("inside app.json's directory") });
    expect(await errorOf(() => deps.files.writeFile("/creds/state/invoices", "1.zip", Buffer.from("x")))).toMatchObject({ kind: "config" });
  });
});

describe("app.json", () => {
  it("is named, never quoted, when it does not parse: V8's message would quote the secret", async () => {
    const { env, configDir, stateDir } = deployment();
    withTokens(stateDir);
    writeFileSync(join(configDir, "app.json"), '{"client_id": "c", "client_secret": s3cr3t-value-123}');
    const text = await toolText(env, "token_status");
    expect(text).toContain("is not JSON");
    expect(text).not.toContain("s3cr3t");
  });
});

describe("re-authorization, end to end", () => {
  it("stores the new grant in the state dir and writes nothing beside a read-only app.json", async () => {
    const { env, configDir, stateDir } = deployment();
    chmodSync(configDir, 0o500);
    try {
      const deps = buildDeps(env, options);
      const begun = await beginAuthorization(deps, { redirectUri: "" });
      const state = new URL(begun.authorizeUrl).searchParams.get("state") ?? "";
      const spy = withFetch(async () => granted());
      const out = await completeAuthorization(deps, {
        redirectUrl: `${begun.redirectUri}?code=the-code&state=${state}`,
        code: "",
        state: "",
      });
      expect(spy).toHaveBeenCalledOnce();
      expect(out).toMatchObject({ ok: true, accessTokenExpiresAt: new Date((NOW + 90 * DAY) * 1000).toISOString() });
      expect(JSON.stringify(out)).not.toContain("SECRET-REFRESH");
      expect((await deps.tokens.read()).refreshToken).toBe("SECRET-REFRESH");
      expect(readdirSync(configDir)).toEqual(["app.json"]);
      expect(readdirSync(stateDir)).not.toContain("authorization.json");
    } finally {
      chmodSync(configDir, 0o700);
    }
  });

  it("refuses a download into app.json's directory, and writes one into the outbox at 0640", async () => {
    const { env, configDir, stateDir } = deployment();
    withTokens(stateDir);
    withFetch(async () => new Response(ARCHIVE));
    const deps = buildDeps(env, options);
    expect(await errorOf(() => downloadInvoice(deps, { messageId: "1", saveDir: configDir, test: false }))).toMatchObject({ kind: "input" });
    expect(readdirSync(configDir)).toEqual(["app.json"]);
    const saved = await downloadInvoice(deps, { messageId: "1", saveDir: "", test: false });
    expect(saved.path).toBe(join(stateDir, "invoices", "1.zip"));
    expect(statSync(saved.path).mode & 0o777).toBe(0o640);
  });
});

describe("the outbox", () => {
  it("never replaces a saved file with other bytes: the same bytes keep their name, others get the next number", async () => {
    const dir = deployment().stateDir;
    const files = makeFiles(inputFilesWith([]));
    const first = await files.writeFile(dir, "EX-0042.pdf", Buffer.from("one"));
    expect(await files.writeFile(dir, "EX-0042.pdf", Buffer.from("one"))).toBe(first);
    const second = await files.writeFile(dir, "EX-0042.pdf", Buffer.from("two"));
    expect(second).toBe(join(dir, "EX-0042-2.pdf"));
    expect(readFileSync(first, "utf8")).toBe("one");
    expect(readFileSync(second, "utf8")).toBe("two");
  });
});

describe("--refresh", () => {
  it("does nothing while the access token has more than fourteen days, and says so", async () => {
    const { env, stateDir } = deployment();
    withTokens(stateDir);
    const spy = withFetch(async () => granted());
    const out = await refreshVerdict(env, { force: false }, options);
    expect(out.code).toBe(0);
    expect(out.line).toMatch(/^ANAF: OK not due/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshes inside the window, or on --force, and never prints a token", async () => {
    const { env, stateDir } = deployment();
    withTokens(stateDir, { accessTokenExpEpoch: NOW + 10 * DAY });
    withFetch(async () => granted());
    const due = await refreshVerdict(env, { force: false }, options);
    expect(due.code).toBe(0);
    expect(due.line).toMatch(/^ANAF: OK refreshed \(access had 10\.0d left\)/);
    const forced = await refreshVerdict(env, { force: true }, options);
    expect(forced.line).toMatch(/^ANAF: OK refreshed \(forced\)/);
    for (const line of [due.line, forced.line]) {
      expect(line).not.toContain("SECRET-REFRESH");
      expect(line).not.toContain("old-access");
    }
  });

  it("FAILs with exit 1 on a dead grant, naming the remedy", async () => {
    const { env, stateDir } = deployment();
    withTokens(stateDir);
    withFetch(async () => json({ error: "invalid_grant", error_description: "revoked" }, 400));
    const out = await refreshVerdict(env, { force: true }, options);
    expect(out.code).toBe(1);
    expect(out.line).toMatch(/^ANAF: FAIL invalid_grant: revoked -- the grant is dead; call begin_authorization/);
  });

  it("WARNs with exit 2 when ANAF is unwell", async () => {
    const { env, stateDir } = deployment();
    withTokens(stateDir);
    withFetch(async () => new Response("down", { status: 503 }));
    const out = await refreshVerdict(env, { force: true }, options);
    expect(out.code).toBe(2);
    expect(out.line).toMatch(/^ANAF: WARN /);
  });

  it("FAILs, not crashes, when the deployment names no paths and holds no grant", async () => {
    const out = await refreshVerdict({}, { force: false }, options);
    expect(out).toMatchObject({ code: 1 });
    expect(out.line).toMatch(/^ANAF: FAIL tokens at .* are missing .* begin_authorization/);
  });
});

describe("--health", () => {
  it("says OK after a HELLO that went through", async () => {
    const { env, stateDir } = deployment();
    withTokens(stateDir);
    withFetch(async () => new Response("Hello health"));
    const out = await healthVerdict(env, options);
    expect(out).toMatchObject({ code: 0 });
    expect(out.line).toMatch(/^ANAF: OK app=test-app cif=RO92345672 roles=EFACTURA/);
  });

  it("warns a fortnight before the grant itself runs out", async () => {
    const { env, stateDir } = deployment();
    withTokens(stateDir, { refreshTokenExpEpoch: NOW + 5 * DAY, accessTokenExpEpoch: NOW + 5 * DAY });
    withFetch(async () => new Response("Hello health"));
    expect((await healthVerdict(env, options)).line).toMatch(/^ANAF: WARN reauthorization due/);
  });
});

/** One tool's result text, as a client sees it. */
const toolText = async (env: NodeJS.ProcessEnv, name: string): Promise<string> => {
  const server = new McpServer({ name: "anaf-efactura", version: "test" });
  registerAll(server, buildDeps(env, options));
  const client = await connectInMemory(server);
  const result = (await client.callTool({ name, arguments: {} })) as { content: { text: string }[] };
  return result.content[0]?.text ?? "";
};

describe("the health tool", () => {
  // TestOauth's hello echoes the request headers, so without a filter the
  // access token would land in the tool result.
  const LIVE = jwt({ exp: NOW + 80 * DAY, roles: "EFACTURA" });
  const echoing = (answer: (authorization: string) => Response) =>
    withFetch(async (_url, init) => answer(String((init?.headers as Record<string, string> | undefined)?.["Authorization"])));

  it("reports hello's greeting and never the headers it echoes", async () => {
    const { env, stateDir } = deployment();
    withTokens(stateDir, { accessToken: LIVE });
    echoing((authorization) => new Response(`Hello health\nAuthorization: ${authorization}\nAccept: */*\n`));
    const text = await toolText(env, "health");
    expect(text).not.toMatch(/Authorization|Bearer/i);
    expect(text).not.toContain(LIVE);
    expect(JSON.parse(text)).toMatchObject({ ok: true, hello: "Hello health" });
  });

  it("withholds a one-line echo whole", async () => {
    const { env, stateDir } = deployment();
    withTokens(stateDir, { accessToken: LIVE });
    echoing((authorization) => json({ message: "Hello health", headers: { Authorization: authorization } }));
    const text = await toolText(env, "health");
    expect(text).not.toMatch(/Authorization|Bearer/i);
    expect(text).not.toContain(LIVE);
    expect(JSON.parse(text)).toMatchObject({ hello: WITHHELD_GREETING });
  });

  it("keeps an echoed token out of a failure's body too", async () => {
    const { env, stateDir } = deployment();
    withTokens(stateDir, { accessToken: LIVE });
    echoing((authorization) => new Response(`Bad request\nAuthorization: ${authorization}`, { status: 400 }));
    const text = await toolText(env, "health");
    expect(text).not.toContain(LIVE);
    expect(JSON.parse(text)).toMatchObject({ error: { kind: "api", status: 400 } });
  });
});

describe("the policy", () => {
  it("classifies exactly the tools the server registers", () => {
    const deps = buildDeps(deployment().env, options);
    const names = registeredNames((server) => registerAll(server, deps));
    expect(names.toSorted()).toEqual(Object.keys(POLICY).toSorted());
    expect(POLICY["upload_invoice"]?.access).toBe("money");
  });
});

