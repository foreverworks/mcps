import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../src/serve/confirm.js";
import { beyondRead, callerKey, checkPublic, clientIpHeaderFrom, hostAccepted, publicHostsFrom } from "../src/serve/public.js";
import type { ToolPolicy } from "../src/policy.js";

describe("publicHostsFrom", () => {
  it("reads host names, 443 unless one names its port, in lower case without a trailing dot", () => {
    expect(publicHostsFrom(" rates.example.com, Other.Example.org.:8443 ,")).toEqual([
      { name: "rates.example.com", port: 443 },
      { name: "other.example.org", port: 8443 },
    ]);
  });

  it("refuses a list that names nothing, and an entry that is not a host name", () => {
    expect(() => publicHostsFrom(" , ")).toThrow(/names no host/);
    expect(() => publicHostsFrom("https://rates.example.com")).toThrow(/"https:\/\/rates.example.com" is not a host name/);
    expect(() => publicHostsFrom("rates.example.com/mcp")).toThrow(/not a host name/);
    expect(() => publicHostsFrom("rates.example.com:0")).toThrow(/not a host name/);
    expect(() => publicHostsFrom("[2001:db8::1]")).toThrow(/not a host name/);
    expect(() => publicHostsFrom("-rates.example.com")).toThrow(/not a host name/);
  });
});

describe("hostAccepted", () => {
  const hosts = publicHostsFrom("rates.example.com,other.example.org:8443");

  it("takes the loopback hosts of the bound port, as a server with tokens does", () => {
    expect(hostAccepted("127.0.0.1:3000", 3000, [])).toBe(true);
    expect(hostAccepted("localhost:3000", 3000, [])).toBe(true);
    expect(hostAccepted("127.0.0.1:3001", 3000, [])).toBe(false);
    expect(hostAccepted("rates.example.com", 3000, [])).toBe(false);
    expect(hostAccepted(undefined, 3000, [])).toBe(false);
  });

  it("takes a listed name with or without its port, and nothing else", () => {
    expect(hostAccepted("rates.example.com", 3000, hosts)).toBe(true);
    expect(hostAccepted("RATES.example.com:443", 3000, hosts)).toBe(true);
    expect(hostAccepted("rates.example.com.", 3000, hosts)).toBe(true);
    expect(hostAccepted("other.example.org:8443", 3000, hosts)).toBe(true);
    expect(hostAccepted("127.0.0.1:3000", 3000, hosts)).toBe(true);
    expect(hostAccepted("rates.example.com:8443", 3000, hosts)).toBe(false);
    expect(hostAccepted("other.example.org", 3000, hosts)).toBe(false);
    expect(hostAccepted("evil.example", 3000, hosts)).toBe(false);
    expect(hostAccepted("rates.example.com.evil.example", 3000, hosts)).toBe(false);
    expect(hostAccepted("[2001:db8::1]:443", 3000, hosts)).toBe(false);
  });
});

describe("clientIpHeaderFrom", () => {
  it("is a header name in lower case, or a process that must not start", () => {
    expect(clientIpHeaderFrom(" CF-Connecting-IP ")).toBe("cf-connecting-ip");
    expect(() => clientIpHeaderFrom("x-forwarded-for: 1")).toThrow(/not a header name/);
  });
});

describe("callerKey", () => {
  it("takes the last address in the header, the one the proxy nearest the server added", () => {
    expect(callerKey("203.0.113.9, 198.51.100.7", "127.0.0.1")).toBe("198.51.100.7");
    expect(callerKey(["203.0.113.9", "198.51.100.7"], "127.0.0.1")).toBe("198.51.100.7");
    expect(callerKey("192.0.2.10", "127.0.0.1")).toBe("192.0.2.10");
  });

  it("drops a port, brackets and a zone around the address", () => {
    expect(callerKey("192.0.2.10:51234", undefined)).toBe("192.0.2.10");
    expect(callerKey("[2001:db8:1:2::9]:443", undefined)).toBe("2001:db8:1:2::/64");
    expect(callerKey(undefined, "2001:db8::1%eth0")).toBe("2001:db8:0:0::/64");
  });

  it("counts an IPv6 caller as its /64, and an IPv4 one mapped into IPv6 as itself", () => {
    expect(callerKey("2001:db8:aa:bb:1:2:3:4", undefined)).toBe("2001:db8:aa:bb::/64");
    expect(callerKey("2001:db8:aa:bb::ffff", undefined)).toBe("2001:db8:aa:bb::/64");
    expect(callerKey("2001:db8:aa:bc::1", undefined)).toBe("2001:db8:aa:bc::/64");
    expect(callerKey("::ffff:192.0.2.10", undefined)).toBe("192.0.2.10");
    expect(callerKey(undefined, "::ffff:c000:20a")).toBe("192.0.2.10");
    expect(callerKey("::", undefined)).toBe("0:0:0:0::/64");
  });

  it("falls back to the connection's address when the header is absent or holds no address", () => {
    expect(callerKey(undefined, "192.0.2.10")).toBe("192.0.2.10");
    expect(callerKey("", "192.0.2.10")).toBe("192.0.2.10");
    expect(callerKey("unknown", "192.0.2.10")).toBe("192.0.2.10");
    expect(callerKey("198.51.100.7, garbage", "192.0.2.10")).toBe("192.0.2.10");
    expect(callerKey(undefined, undefined)).toBe("unknown");
  });
});

describe("a public server's tools", () => {
  const reads: ToolPolicy = { rate: { access: "read" }, convert: { access: "read" } };
  const mixed: ToolPolicy = {
    ...reads,
    label: { access: "write" },
    pay: { access: "money", summary: () => "pay" },
  };

  it("may all be reads", () => {
    expect(beyondRead(reads, DEFAULT_SETTINGS)).toEqual([]);
    expect(() => checkPublic("rates", reads, DEFAULT_SETTINGS)).not.toThrow();
  });

  it("may not include a write or money tool that a call could run, and the error says why", () => {
    expect(beyondRead(mixed, DEFAULT_SETTINGS)).toEqual(["label (write)", "pay (money)"]);
    expect(beyondRead(mixed, { ...DEFAULT_SETTINGS, maxAccess: "write" })).toEqual(["label (write)"]);
    expect(() => checkPublic("rates", mixed, DEFAULT_SETTINGS)).toThrow(/rates: .*no sign-in, so anyone can call it.*label \(write\), pay \(money\) could.*MCP_MAX_ACCESS=read/);
  });

  it("may include them when a ceiling refuses every call to them: the server's own, or the one for the client `public`", () => {
    expect(beyondRead(mixed, { ...DEFAULT_SETTINGS, maxAccess: "read" })).toEqual([]);
    expect(beyondRead(mixed, { ...DEFAULT_SETTINGS, clientMaxAccess: { public: "read" } })).toEqual([]);
    expect(beyondRead(mixed, { ...DEFAULT_SETTINGS, clientMaxAccess: { someone: "read" } })).toEqual(["label (write)", "pay (money)"]);
  });
});
