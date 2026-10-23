/**
 * The shell-callable health check: ONE `OBLIO:` line and an exit code, the
 * kit's verdict contract, over temp files and a stubbed fetch.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runHealthCheck } from "../src/cli/health.js";
import { CIF, envelope, json, tempDir, withFetch } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

const deployment = (): NodeJS.ProcessEnv => {
  const dir = tempDir();
  const config = join(dir, "app.json");
  writeFileSync(config, JSON.stringify({ client_id: "account@example.test", client_secret: "secret", company_cif: CIF, api_base: "https://oblio.test/api", token_url: "https://oblio.test/api/authorize/token" }));
  mkdirSync(join(dir, "state"));
  return { OBLIO_CONFIG: config, OBLIO_STATE_DIR: join(dir, "state") };
};

const run = async (env: NodeJS.ProcessEnv) => {
  const lines: string[] = [];
  const code = await runHealthCheck((line) => lines.push(line), env);
  return { code, lines };
};

describe("--health", () => {
  it("says ok when the credentials work", async () => {
    withFetch(async (url) =>
      url.includes("/authorize/token") ? json({ access_token: "t", expires_in: 3600 }) : envelope([{ cif: CIF, company: "Exemplu SRL" }]),
    );
    expect(await run(deployment())).toEqual({ code: 0, lines: [`OBLIO: ok account=account@example.test cif=${CIF}`] });
  });

  it("FAILs naming the variable when there is no app.json", async () => {
    const { code, lines } = await run({});
    expect(code).toBe(1);
    expect(lines).toEqual([expect.stringMatching(/^OBLIO: FAIL no app.json: set OBLIO_CONFIG to its path.* -- /)]);
  });

  it("FAILs when Oblio refuses the secret", async () => {
    withFetch(async () => json({ statusMessage: "Invalid client" }, 401));
    const { code, lines } = await run(deployment());
    expect(code).toBe(1);
    expect(lines[0]).toMatch(/^OBLIO: FAIL Oblio refused the credentials .* -- Oblio refused the client_id and secret/);
  });
});
