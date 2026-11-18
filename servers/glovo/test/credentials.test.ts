import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadCredentials, unwrapJsonString } from "../src/infra/credentials.js";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.payload.signature";

describe("unwrapJsonString", () => {
  it("unwraps a token copied with the double quotes the web app stores it in", () => {
    expect(unwrapJsonString(`"${TOKEN}"`)).toBe(TOKEN);
  });

  it("leaves a plain token unchanged", () => {
    expect(unwrapJsonString(TOKEN)).toBe(TOKEN);
  });

  it("leaves a quoted value that is not a JSON string as it is", () => {
    for (const odd of ['"', '""x', `"${TOKEN}`, `${TOKEN}"`, `"a"b"`, `"bad\\escape"`]) {
      expect(unwrapJsonString(odd)).toBe(odd);
    }
  });
});

describe("loadCredentials", () => {
  const write = async (credentials: unknown) => {
    const path = join(await mkdtemp(join(tmpdir(), "glovo-creds-")), "credentials.json");
    await writeFile(path, JSON.stringify(credentials));
    return { variable: "GLOVO_CREDS", path };
  };

  it("reads a plain refresh token as it is", async () => {
    const file = await write({ refresh_token: TOKEN, device_urn: "glv:device:test" });
    expect(await loadCredentials(file)).toEqual({ refreshToken: TOKEN, deviceUrn: "glv:device:test" });
  });

  it("unwraps a refresh token the file holds with its JSON quotes, and leaves the device urn alone", async () => {
    const file = await write({ refresh_token: `"${TOKEN}"`, device_urn: "glv:device:test" });
    expect(await loadCredentials(file)).toEqual({ refreshToken: TOKEN, deviceUrn: "glv:device:test" });
  });
});
