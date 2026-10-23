/** app.json's path comes from the environment only; it is read, never written, and never quoted. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/infra/config.js";
import { resolvePaths } from "../src/infra/paths.js";
import { errorOf, tempDir } from "./helpers.js";

describe("resolvePaths", () => {
  it("has no default for app.json, and the kit's default for state", () => {
    expect(resolvePaths({ HOME: "/home/someone" })).toEqual({ config: undefined, stateDir: "/home/someone/.local/state/mcps/oblio" });
  });

  it("takes systemd's credentials and state directories", () => {
    expect(resolvePaths({ CREDENTIALS_DIRECTORY: "/run/credentials/oblio.service", STATE_DIRECTORY: "/srv/state/oblio:/srv/state/other" })).toEqual({
      config: "/run/credentials/oblio.service/app.json",
      stateDir: "/srv/state/oblio",
    });
  });

  it("lets the explicit variables win", () => {
    expect(
      resolvePaths({
        OBLIO_CONFIG: "/etc/oblio.json",
        OBLIO_STATE_DIR: "/tmp/state",
        CREDENTIALS_DIRECTORY: "/run/c",
        STATE_DIRECTORY: "/srv/s",
      }),
    ).toEqual({ config: "/etc/oblio.json", stateDir: "/tmp/state" });
  });
});

describe("loadConfig", () => {
  const write = (content: string) => {
    const path = join(tempDir(), "app.json");
    writeFileSync(path, content);
    return path;
  };

  it("reads the three required fields and defaults the endpoints", async () => {
    const path = write(JSON.stringify({ client_id: "a@b.test", client_secret: "s3cret", company_cif: "RO1" }));
    await expect(loadConfig(path)).resolves.toEqual({
      clientId: "a@b.test",
      clientSecret: "s3cret",
      companyCif: "RO1",
      apiBase: "https://www.oblio.eu/api",
      tokenUrl: "https://www.oblio.eu/api/authorize/token",
    });
  });

  it("names a missing field by its name and never quotes a value", async () => {
    const path = write(JSON.stringify({ client_id: "a@b.test", client_secret: "s3cret-value" }));
    const error = await errorOf(() => loadConfig(path));
    expect(error).toMatchObject({ kind: "config" });
    expect(error?.message).toContain("company_cif");
    expect(error?.message).not.toContain("s3cret-value");
  });

  it("does not echo a file that is not JSON", async () => {
    const error = await errorOf(() => loadConfig(write("client_secret=s3cret-value")));
    expect(error?.message).toContain("is not JSON");
    expect(error?.message).not.toContain("s3cret");
  });

  it("names the variables when there is no path at all", async () => {
    expect((await errorOf(() => loadConfig(undefined)))?.message).toContain("OBLIO_CONFIG");
  });
});
