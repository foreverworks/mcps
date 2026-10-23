/**
 * Where the server looks, and what it makes of app.json. Every path here is in
 * a temp dir handed in through the environment.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { API_BASE, loadConfig } from "../src/infra/config.js";
import { resolvePaths } from "../src/infra/paths.js";
import { rejectionOf, tempDir, TEST_APP } from "./support.js";

const appJson = (dir: string, content: unknown): string => {
  const path = join(dir, "app.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
};

describe("resolvePaths", () => {
  it("takes every path from its variable", () => {
    expect(
      resolvePaths({
        ENABLE_BANKING_CONFIG: "/run/credentials/enable-banking.service/eb-app",
        ENABLE_BANKING_KEY: "/run/credentials/enable-banking.service/eb-key",
        ENABLE_BANKING_STATE_DIR: "/srv/state/enable-banking",
        ENABLE_BANKING_EXPORTS_DIR: "/srv/exports/enable-banking",
      }),
    ).toEqual({
      config: "/run/credentials/enable-banking.service/eb-app",
      keyOverride: "/run/credentials/enable-banking.service/eb-key",
      stateDir: "/srv/state/enable-banking",
      sessions: "/srv/state/enable-banking/sessions.json",
      backup: "/srv/state/enable-banking/sessions.json.bak",
      exportsDir: "/srv/exports/enable-banking",
    });
  });

  it("has no default for the credentials, and the kit's default for state", () => {
    expect(resolvePaths({ HOME: "/home/someone", ENABLE_BANKING_KEY: "  " })).toMatchObject({
      config: undefined,
      keyOverride: undefined,
      stateDir: "/home/someone/.local/state/mcps/enable-banking",
    });
    expect(resolvePaths({ STATE_DIRECTORY: "/srv/state/eb" }).sessions).toBe("/srv/state/eb/sessions.json");
    expect(resolvePaths({ STATE_DIRECTORY: "/srv/state/eb" }).exportsDir).toBe("/srv/state/eb/exports");
  });
});

describe("loadConfig", () => {
  it("reads app.json and resolves a relative private_key beside it", async () => {
    const dir = tempDir();
    const config = await loadConfig(appJson(dir, TEST_APP));
    expect(config).toEqual({
      applicationId: TEST_APP.application_id,
      applicationName: TEST_APP.application_name,
      environment: "sandbox",
      redirectUrl: TEST_APP.redirect_url,
      privateKeyPath: join(dir, "app.key"),
      apiBase: API_BASE,
    });
  });

  it("uses the key the environment names, since a credentials dir renames files", async () => {
    const dir = tempDir();
    const config = await loadConfig(appJson(dir, TEST_APP), "/run/credentials/x/eb-key");
    expect(config.privateKeyPath).toBe("/run/credentials/x/eb-key");
  });

  it("needs no private_key in app.json when the environment names the key", async () => {
    const { private_key: _unused, ...withoutKey } = TEST_APP;
    const dir = tempDir();
    expect((await loadConfig(appJson(dir, withoutKey), "/k")).privateKeyPath).toBe("/k");
    expect(await rejectionOf(() => loadConfig(appJson(dir, withoutKey)))).toMatchObject({
      kind: "config",
      message: expect.stringContaining("ENABLE_BANKING_KEY"),
    });
  });

  it("takes an absolute private_key as it is", async () => {
    const dir = tempDir();
    expect((await loadConfig(appJson(dir, { ...TEST_APP, private_key: "/etc/keys/eb.key" }))).privateKeyPath).toBe("/etc/keys/eb.key");
  });

  it("names the variable when there is no app.json at all", async () => {
    expect(await rejectionOf(() => loadConfig(undefined))).toMatchObject({
      kind: "config",
      message: "ENABLE_BANKING_CONFIG is not set; this server has no default location",
    });
  });

  it("ignores the control panel's other keys", async () => {
    const dir = tempDir();
    const config = await loadConfig(appJson(dir, { ...TEST_APP, services: ["AIS"], created: "2020-01-01", activation_mode: "x" }));
    expect(config.applicationId).toBe(TEST_APP.application_id);
  });

  it("says what is wrong with an unusable app.json, as a config failure", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "empty"));
    expect(await rejectionOf(() => loadConfig(join(dir, "empty", "app.json")))).toMatchObject({ kind: "config" });
    expect(await rejectionOf(() => loadConfig(appJson(dir, "{not json")))).toMatchObject({ kind: "config" });
    // V8's parse error quotes the text around the fault; here that text is an inline key.
    const broken = await rejectionOf(() => loadConfig(appJson(dir, '{"application_id": "x", "private_key": MIIEvQIBADANBgkqhkiG}')));
    expect(broken).toMatchObject({ kind: "config", message: expect.stringContaining("is not JSON") });
    expect(JSON.stringify(broken)).not.toContain("MIIEvQ");
    expect(await rejectionOf(() => loadConfig(appJson(dir, { redirect_url: "x", private_key: "k" })))).toMatchObject({
      kind: "config",
      message: expect.stringContaining("application_id"),
    });
  });
});
