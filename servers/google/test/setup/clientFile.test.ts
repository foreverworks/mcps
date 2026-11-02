import { describe, expect, it } from "vitest";

import { checkClientFile, isClientFileName } from "../../src/setup/domain/clientFile.js";

const installed = { client_id: "123-abc.apps.googleusercontent.com", project_id: "my-project-1", client_secret: "test-secret", redirect_uris: ["http://localhost"] };

describe("checkClientFile", () => {
  it("takes a Desktop app client, with its project", () => {
    expect(checkClientFile({ installed })).toEqual({ ok: { clientId: installed.client_id, projectId: "my-project-1" } });
    const { project_id: _, ...withoutProject } = installed;
    expect(checkClientFile({ installed: withoutProject })).toEqual({ ok: { clientId: installed.client_id } });
  });

  it("refuses a Web application client, saying which type to create", () => {
    expect(checkClientFile({ web: installed })).toEqual({ problem: expect.stringContaining("Desktop app") });
  });

  it("names what a client lacks", () => {
    expect(checkClientFile({ installed: { ...installed, client_secret: "" } })).toEqual({ problem: "its Desktop app client lacks client_secret" });
    expect(checkClientFile({ installed: { project_id: "p" } })).toEqual({ problem: "its Desktop app client lacks client_id and client_secret" });
    expect(checkClientFile({ refresh_token: "x" })).toHaveProperty("problem");
    expect(checkClientFile([1])).toHaveProperty("problem");
    expect(checkClientFile(null)).toHaveProperty("problem");
  });
});

describe("isClientFileName", () => {
  it("knows Google's download, and a second copy of it", () => {
    expect(isClientFileName("client_secret_123-abc.apps.googleusercontent.com.json")).toBe(true);
    expect(isClientFileName("client_secret_123-abc.apps.googleusercontent.com (1).json")).toBe(true);
    expect(isClientFileName("client_secret_123.json.crdownload")).toBe(false);
    expect(isClientFileName("credentials.json")).toBe(false);
  });
});
