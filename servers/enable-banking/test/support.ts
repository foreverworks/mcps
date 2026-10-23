/**
 * What the tests here share: a throwaway RSA key (generated per test file,
 * never the real one), a temp directory per test holding app.json, that key and
 * the state dir, and a fetch stub that answers by route and refuses anything it
 * was not told about. Isolation itself is the kit's (testing/isolate.ts); these
 * only make the explicit environment every test hands in.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import { asAppError, type AppError } from "../src/domain/errors.js";
import { resolvePaths } from "../src/infra/paths.js";

export const TEST_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const TEST_KEY_PEM = TEST_KEY.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

/** app.json as testEnv writes it. Nothing in it is real. */
export const TEST_APP = {
  application_id: "00000000-0000-4000-8000-0000000000ab",
  application_name: "test application",
  environment: "sandbox",
  redirect_url: "https://example.test/callback",
  private_key: "app.key",
  public_cert: "app.crt",
} as const;

export const tempDir = (prefix = "eb-test-"): string => mkdtempSync(join(tmpdir(), prefix));

/**
 * A fresh environment: every ENABLE_BANKING_* variable points into a new temp
 * dir, where app.json and the throwaway key are written the way
 * a systemd credentials dir holds them (key named by the env, not by app.json).
 */
export const testEnv = (): NodeJS.ProcessEnv => {
  const dir = tempDir();
  const creds = join(dir, "credentials");
  mkdirSync(creds, { recursive: true });
  writeFileSync(join(creds, "app.json"), JSON.stringify(TEST_APP), { mode: 0o600 });
  writeFileSync(join(creds, "eb-key"), TEST_KEY_PEM, { mode: 0o600 });
  return {
    ENABLE_BANKING_CONFIG: join(creds, "app.json"),
    ENABLE_BANKING_KEY: join(creds, "eb-key"),
    ENABLE_BANKING_STATE_DIR: join(dir, "state"),
  };
};

export const pathsOf = (env: NodeJS.ProcessEnv) => resolvePaths(env);

export const API = "https://api.enablebanking.com";

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/**
 * Stub fetch with handlers keyed by "METHOD /path" (the query is not part of
 * the key). A request no handler names fails the test loudly, which is the
 * point: nothing here may reach a network by accident.
 */
export const routeFetch = (routes: Readonly<Record<string, Handler>>) => {
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const handler = routes[key];
    if (handler === undefined) throw new Error(`unrouted request in a test: ${key}`);
    return handler(url, init);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
};

/** The JSON body of the n-th call a fetch spy saw. */
export const sentBody = (spy: ReturnType<typeof routeFetch>, n = 0): unknown =>
  JSON.parse(String(spy.mock.calls[n]?.[1]?.body)) as unknown;

/** The tagged failure a synchronous call threw, or undefined when it did not throw one. */
export const thrownBy = (fn: () => unknown): AppError | undefined => {
  try {
    fn();
    return undefined;
  } catch (thrown) {
    return asAppError(thrown);
  }
};

/** The tagged failure an async call rejected with, or undefined when it did not. */
export const rejectionOf = async (run: () => Promise<unknown>): Promise<AppError | undefined> => {
  try {
    await run();
    return undefined;
  } catch (thrown) {
    return asAppError(thrown);
  }
};
