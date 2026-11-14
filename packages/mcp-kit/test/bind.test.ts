import { describe, expect, it } from "vitest";

import { allowedHostsFrom, allowedHostText, bindHostFrom, isLoopbackAddress, urlHost } from "../src/serve/bind.js";

describe("bindHostFrom", () => {
  it("takes an IP address of either family, and localhost", () => {
    expect(bindHostFrom(" 0.0.0.0 ")).toBe("0.0.0.0");
    expect(bindHostFrom("192.0.2.10")).toBe("192.0.2.10");
    expect(bindHostFrom("::")).toBe("::");
    expect(bindHostFrom("2001:db8::1")).toBe("2001:db8::1");
    expect(bindHostFrom("LocalHost")).toBe("localhost");
  });

  it("refuses a name to resolve, a bracketed address and a URL, saying what to write", () => {
    expect(() => bindHostFrom("mcp.internal")).toThrow(/MCP_HTTP_HOST "mcp.internal" is not an IP address: write 0.0.0.0/);
    expect(() => bindHostFrom("[::1]")).toThrow(/not an IP address/);
    expect(() => bindHostFrom("http://0.0.0.0")).toThrow(/not an IP address/);
    expect(() => bindHostFrom("0.0.0.0:8080")).toThrow(/not an IP address/);
  });
});

describe("isLoopbackAddress", () => {
  it("is true for the addresses only this machine reaches", () => {
    for (const host of ["127.0.0.1", "127.0.0.2", "127.255.255.254", "::1", "localhost"]) expect(isLoopbackAddress(host)).toBe(true);
  });

  it("is false for every other address, the wildcard ones included", () => {
    for (const host of ["0.0.0.0", "::", "192.0.2.10", "128.0.0.1", "198.51.100.1", "2001:db8::1", "::ffff:127.0.0.1"]) expect(isLoopbackAddress(host)).toBe(false);
  });
});

describe("allowedHostsFrom", () => {
  it("reads names, with a port only where one is written, in lower case without a trailing dot", () => {
    expect(allowedHostsFrom(" mcp.internal, Svc.Example.org.:8080 ,192.0.2.7,")).toEqual([
      { name: "mcp.internal", port: undefined },
      { name: "svc.example.org", port: 8080 },
      { name: "192.0.2.7", port: undefined },
    ]);
    expect(allowedHostsFrom("localhost").map(allowedHostText)).toEqual(["localhost"]);
    expect(allowedHostsFrom("mcp:80").map(allowedHostText)).toEqual(["mcp:80"]);
  });

  it("refuses a list that names nothing, and an entry that is not a host name, naming the variable", () => {
    expect(() => allowedHostsFrom(" , ")).toThrow(/MCP_HTTP_ALLOWED_HOSTS " , " names no host/);
    expect(() => allowedHostsFrom("https://mcp.internal")).toThrow(/MCP_HTTP_ALLOWED_HOSTS entry "https:\/\/mcp.internal" is not a host name/);
    expect(() => allowedHostsFrom("mcp.internal/mcp")).toThrow(/not a host name/);
    expect(() => allowedHostsFrom("mcp.internal:0")).toThrow(/not a host name/);
    expect(() => allowedHostsFrom("mcp.internal:99999")).toThrow(/not a host name/);
    expect(() => allowedHostsFrom("[::1]:8080")).toThrow(/not a host name/);
    expect(() => allowedHostsFrom("*.internal")).toThrow(/not a host name/);
  });
});

describe("urlHost", () => {
  it("brackets an IPv6 address and leaves the rest", () => {
    expect(urlHost("::")).toBe("[::]");
    expect(urlHost("0.0.0.0")).toBe("0.0.0.0");
  });
});
