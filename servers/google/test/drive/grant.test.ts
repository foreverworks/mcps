import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { asAppError } from "../../src/drive/domain/errors.js";
import { loadRcloneCredentials, readSection } from "../../src/drive/infra/rcloneGrant.js";

const conf = async (text: string): Promise<string> => {
  const path = join(await mkdtemp(join(tmpdir(), "rclone-")), "rclone.conf");
  await writeFile(path, text);
  return path;
};

const TOKEN = JSON.stringify({ access_token: "a", refresh_token: "r=1", expiry: "2026-09-28T10:00:00Z" });

describe("readSection", () => {
  it("reads one section, splitting on the first = only, and skips comments", () => {
    const ini = `[other]\nclient_id = no\n\n[gdrive]\n# note\ntype = drive\ntoken = ${TOKEN}\n`;
    expect(readSection(ini, "gdrive")).toEqual({ type: "drive", token: TOKEN });
  });
});

describe("the Drive mirror's grant", () => {
  it("reads our own client and the refresh token out of the remote", async () => {
    const rcloneConf = await conf(`[gdrive]\ntype = drive\nclient_id = ours.apps\nclient_secret = s3\ntoken = ${TOKEN}\n`);
    await expect(loadRcloneCredentials({ rcloneConf, rcloneRemote: "gdrive" })).resolves.toMatchObject({
      clientId: "ours.apps",
      clientSecret: "s3",
      refreshToken: "r=1",
    });
  });

  it("refuses a remote on rclone's built-in client, and says how to fix it", async () => {
    const rcloneConf = await conf(`[gdrive]\ntype = drive\ntoken = ${TOKEN}\n`);
    const thrown = await loadRcloneCredentials({ rcloneConf, rcloneRemote: "gdrive" }).catch((e: unknown) => e);
    expect(asAppError(thrown)).toMatchObject({ kind: "config", message: expect.stringMatching(/built-in OAuth client/) });
  });

  it("refuses a token with no refresh token in it", async () => {
    const rcloneConf = await conf(`[gdrive]\nclient_id = c\nclient_secret = s\ntoken = {"access_token":"a"}\n`);
    const thrown = await loadRcloneCredentials({ rcloneConf, rcloneRemote: "gdrive" }).catch((e: unknown) => e);
    expect(asAppError(thrown)).toMatchObject({ kind: "config", message: expect.stringMatching(/no refresh token/) });
  });
});
