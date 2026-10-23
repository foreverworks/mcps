import { describe, expect, it } from "vitest";

import { envPath, stateDirOf, timeZoneOf } from "../src/env.js";

describe("envPath", () => {
  it("is the variable made absolute, and nothing for blank", () => {
    expect(envPath({ X: "/a/b" }, "X")).toBe("/a/b");
    expect(envPath({ X: "  " }, "X")).toBeUndefined();
    expect(envPath({}, "X")).toBeUndefined();
  });
});

describe("stateDirOf", () => {
  it("prefers the server's own variable, then systemd's StateDirectory, then XDG", () => {
    expect(stateDirOf({ OBLIO_STATE_DIR: "/s", STATE_DIRECTORY: "/var/lib/x" }, "oblio", "OBLIO_STATE_DIR")).toBe("/s");
    expect(stateDirOf({ STATE_DIRECTORY: "/var/lib/a:/var/lib/b" }, "oblio", "OBLIO_STATE_DIR")).toBe("/var/lib/a");
    expect(stateDirOf({ XDG_STATE_HOME: "/x" }, "oblio", "OBLIO_STATE_DIR")).toBe("/x/mcps/oblio");
    expect(stateDirOf({ HOME: "/home/u" }, "oblio", "OBLIO_STATE_DIR")).toBe("/home/u/.local/state/mcps/oblio");
  });
});

describe("timeZoneOf", () => {
  it("reads the server's variable, else the process's zone, and refuses a zone that does not exist", () => {
    expect(timeZoneOf({ CAL_TZ: "Europe/Bucharest" }, "CAL_TZ")).toBe("Europe/Bucharest");
    expect(timeZoneOf({}, "CAL_TZ")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(() => timeZoneOf({ CAL_TZ: "Mars/Olympus" }, "CAL_TZ")).toThrow(/CAL_TZ "Mars\/Olympus" is not an IANA time zone/);
  });
});
