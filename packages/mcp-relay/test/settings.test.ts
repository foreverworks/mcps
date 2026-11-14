import { describe, expect, it } from "vitest";

import { settingsFrom } from "../src/settings.js";

const base = {
  MCP_HTTP_PORT: "8750",
  MCP_HTTP_TOKENS_DIR: "/run/tokens",
  MCP_RELAY_UPSTREAM: "https://mcp.example.com",
  MCP_RELAY_UPSTREAM_TOKEN_FILE: "/run/upstream-token",
};

describe("settingsFrom", () => {
  it("reads how it listens as a server does, and where it forwards", () => {
    expect(settingsFrom({ ...base, MCP_HTTP_HOST: "0.0.0.0", MCP_HTTP_ALLOWED_HOSTS: "relay.internal", MCP_RELAY_INBOX: "/srv/inbox/", MCP_RELAY_OUTBOX: "/srv/outbox" })).toMatchObject({
      port: 8750,
      host: "0.0.0.0",
      allowedHosts: [{ name: "relay.internal", port: undefined }],
      tokens: { kind: "dir", dir: "/run/tokens" },
      upstream: "https://mcp.example.com",
      upstreamTokenFile: "/run/upstream-token",
      inbox: "/srv/inbox",
      outbox: "/srv/outbox",
      maxFileBytes: 256 * 1024 * 1024,
      limits: { maxBodyBytes: 4 * 1024 * 1024 },
    });
  });

  it("carries no folder it was not given, and listens on the loopback address", () => {
    const settings = settingsFrom({ ...base, MCP_RELAY_INBOX: " ", MCP_RELAY_OUTBOX: "" });
    expect(settings).not.toHaveProperty("inbox");
    expect(settings).not.toHaveProperty("outbox");
    expect(settings).not.toHaveProperty("host");
  });

  it("keeps the path an upstream lives under, and drops a trailing slash", () => {
    expect(settingsFrom({ ...base, MCP_RELAY_UPSTREAM: "https://example.com/mcp-servers/oblio/" }).upstream).toBe("https://example.com/mcp-servers/oblio");
    expect(settingsFrom({ ...base, MCP_RELAY_UPSTREAM: "https://192.0.2.10:8080/" }).upstream).toBe("https://192.0.2.10:8080");
  });

  it("takes plain http to this machine, and refuses it to any other unless told it is an encrypted network", () => {
    for (const local of ["http://127.0.0.1:8080", "http://localhost:8080", "http://[::1]:8080", "http://127.0.0.2"]) {
      expect(settingsFrom({ ...base, MCP_RELAY_UPSTREAM: local })).toMatchObject({ plainHttp: false });
    }
    for (const remote of ["http://192.0.2.10:8080", "http://mcp.example.com", "http://[2001:db8::1]:8080"]) {
      expect(() => settingsFrom({ ...base, MCP_RELAY_UPSTREAM: remote })).toThrow(/plain http to a host that is not this machine.*MCP_RELAY_ALLOW_PLAIN_HTTP=1/);
      expect(() => settingsFrom({ ...base, MCP_RELAY_UPSTREAM: remote, MCP_RELAY_ALLOW_PLAIN_HTTP: "yes" })).toThrow(/MCP_RELAY_ALLOW_PLAIN_HTTP=1/);
      expect(settingsFrom({ ...base, MCP_RELAY_UPSTREAM: remote, MCP_RELAY_ALLOW_PLAIN_HTTP: "1" })).toMatchObject({ plainHttp: true });
    }
    expect(settingsFrom({ ...base, MCP_RELAY_ALLOW_PLAIN_HTTP: "1" })).toMatchObject({ plainHttp: false });
  });

  it("takes a size limit of its own", () => {
    expect(settingsFrom({ ...base, MCP_RELAY_MAX_FILE_BYTES: "1048576" }).maxFileBytes).toBe(1048576);
  });

  it.each([
    ["no port", { MCP_HTTP_PORT: "" }, /MCP_HTTP_PORT is not set/],
    ["no tokens", { MCP_HTTP_TOKENS_DIR: "" }, /MCP_HTTP_TOKENS_DIR or MCP_HTTP_TOKEN_FILE/],
    ["public hosts", { MCP_HTTP_TOKENS_DIR: "", MCP_HTTP_PUBLIC_HOSTS: "relay.example.com" }, /MCP_HTTP_PUBLIC_HOSTS is set/],
    ["a server's own file endpoints", { MCP_HTTP_FILES_INBOX: "/srv/in" }, /configure a server's own file endpoints/],
    ["no upstream", { MCP_RELAY_UPSTREAM: "" }, /MCP_RELAY_UPSTREAM is not set/],
    ["an upstream that is not a URL", { MCP_RELAY_UPSTREAM: "mcp.example.com" }, /is not a URL/],
    ["an upstream that is not http", { MCP_RELAY_UPSTREAM: "ftp://mcp.example.com" }, /not an http or https URL/],
    ["an upstream with a password", { MCP_RELAY_UPSTREAM: "https://user:secret@mcp.example.com" }, /user name or password/],
    ["an upstream with a query", { MCP_RELAY_UPSTREAM: "https://mcp.example.com?x=1" }, /query or a fragment/],
    ["an upstream that is the route", { MCP_RELAY_UPSTREAM: "https://mcp.example.com/mcp" }, /ends in \/mcp/],
    ["no upstream token", { MCP_RELAY_UPSTREAM_TOKEN_FILE: "" }, /MCP_RELAY_UPSTREAM_TOKEN_FILE is not set/],
    ["a folder that is not in full", { MCP_RELAY_INBOX: "inbox" }, /MCP_RELAY_INBOX "inbox" is not an absolute path/],
    ["an outbox that is not in full", { MCP_RELAY_OUTBOX: "./out" }, /MCP_RELAY_OUTBOX/],
    ["a size that is not one", { MCP_RELAY_MAX_FILE_BYTES: "-1" }, /is not a number of bytes/],
  ])("refuses to start with %s", (_what, change, message) => {
    expect(() => settingsFrom({ ...base, ...change })).toThrow(message);
  });

  it("does not put the upstream's secret in the message about it", () => {
    expect(() => settingsFrom({ ...base, MCP_RELAY_UPSTREAM: "https://user:hunter2@mcp.example.com" })).toThrow(/^(?!.*hunter2)/);
  });
});
