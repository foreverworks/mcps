/**
 * The shell-callable health check: ONE `ENABLEBANKING:` line and an exit code,
 * the kit's verdict contract, over a temp environment and a stubbed fetch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { runHealthCheck } from "../src/cli/health.js";
import { json, routeFetch, testEnv } from "./support.js";

afterEach(() => vi.unstubAllGlobals());

const run = async (env: NodeJS.ProcessEnv) => {
  const lines: string[] = [];
  const code = await runHealthCheck((line) => lines.push(line), env);
  return { code, lines };
};

describe("--health", () => {
  it("says ok when the key pair is accepted", async () => {
    routeFetch({ "GET /application": () => json({ name: "app", kid: "k", environment: "SANDBOX", redirect_urls: [], active: true, countries: [], services: ["AIS"] }) });
    expect(await run(testEnv())).toEqual({ code: 0, lines: ["ENABLEBANKING: ok app=test application env=sandbox sessions=0"] });
  });

  it("FAILs naming the variable when the deployment gives no path", async () => {
    const { code, lines } = await run({});
    expect(code).toBe(1);
    expect(lines).toEqual([expect.stringMatching(/^ENABLEBANKING: FAIL ENABLE_BANKING_CONFIG is not set; .* -- .*ENABLE_BANKING_KEY/)]);
  });

  it("FAILs when Enable Banking refuses the signed JWT", async () => {
    routeFetch({ "GET /application": () => json({ error: "UNAUTHORIZED" }, 401) });
    const { code, lines } = await run(testEnv());
    expect(code).toBe(1);
    expect(lines[0]).toMatch(/^ENABLEBANKING: FAIL .* -- Enable Banking refused the signed JWT/);
  });
});
