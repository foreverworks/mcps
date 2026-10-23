import { describe, expect, it } from "vitest";

import type { ToolPolicy } from "../src/policy.js";
import { toolsetPolicy, toolsetsFrom } from "../src/toolsets.js";

const REFERENCE: ToolPolicy = { api_reference: { access: "read" } };
const TOOLSETS = {
  mail: { search_mail: { access: "read" }, send_mail: { access: "write" } },
  calendar: { agenda: { access: "read" } },
  notes: { read_note: { access: "read" }, ...REFERENCE },
  sheets: { read_sheet: { access: "read" }, ...REFERENCE },
} as const satisfies Readonly<Record<string, ToolPolicy>>;
const ALWAYS: ToolPolicy = { health: { access: "read" } };

describe("toolsetsFrom", () => {
  it("loads every toolset when the variable is unset, blank, or says all", () => {
    const every = ["mail", "calendar", "notes", "sheets"];
    expect(toolsetsFrom({}, "X_TOOLSETS", TOOLSETS)).toEqual(every);
    expect(toolsetsFrom({ X_TOOLSETS: "  " }, "X_TOOLSETS", TOOLSETS)).toEqual(every);
    expect(toolsetsFrom({ X_TOOLSETS: " , " }, "X_TOOLSETS", TOOLSETS)).toEqual(every);
    expect(toolsetsFrom({ X_TOOLSETS: "all" }, "X_TOOLSETS", TOOLSETS)).toEqual(every);
    expect(toolsetsFrom({ X_TOOLSETS: "mail,all" }, "X_TOOLSETS", TOOLSETS)).toEqual(every);
  });

  it("loads the ones named, in the server's order, whatever the spacing and repeats", () => {
    expect(toolsetsFrom({ X_TOOLSETS: "calendar, mail,calendar," }, "X_TOOLSETS", TOOLSETS)).toEqual(["mail", "calendar"]);
  });

  it("refuses a name that is not a toolset, naming the ones there are", () => {
    expect(() => toolsetsFrom({ X_TOOLSETS: "mail,mial" }, "X_TOOLSETS", TOOLSETS)).toThrow(
      'X_TOOLSETS names "mial", which is not a toolset: the toolsets are mail, calendar, notes, sheets, or all (the default)',
    );
    expect(() => toolsetsFrom({ X_TOOLSETS: "Mail,photos" }, "X_TOOLSETS", TOOLSETS)).toThrow(/names "Mail", "photos", which are not toolsets/);
  });

  it("refuses a server that calls one of its toolsets all", () => {
    expect(() => toolsetsFrom({}, "X_TOOLSETS", { all: {} })).toThrow(/cannot name a toolset/);
  });
});

describe("toolsetPolicy", () => {
  it("is the tools always loaded and those of the loaded toolsets, nothing else", () => {
    expect(Object.keys(toolsetPolicy(ALWAYS, TOOLSETS, ["calendar"])).sort()).toEqual(["agenda", "health"]);
    expect(Object.keys(toolsetPolicy(ALWAYS, TOOLSETS, [])).sort()).toEqual(["health"]);
  });

  it("loads a shared tool once with any toolset that has it", () => {
    expect(Object.keys(toolsetPolicy(ALWAYS, TOOLSETS, ["notes"])).sort()).toEqual(["api_reference", "health", "read_note"]);
    expect(Object.keys(toolsetPolicy(ALWAYS, TOOLSETS, ["notes", "sheets"])).sort()).toEqual(["api_reference", "health", "read_note", "read_sheet"]);
  });

  it("refuses one tool given two rules", () => {
    const clashing = { mail: { agenda: { access: "write" } }, calendar: { agenda: { access: "read" } } } as const satisfies Readonly<Record<string, ToolPolicy>>;
    expect(() => toolsetPolicy(ALWAYS, clashing, ["mail", "calendar"])).toThrow("tools classified twice: agenda");
  });
});
