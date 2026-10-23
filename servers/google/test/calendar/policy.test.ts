import type { McpServer } from "@foreverworks/mcp-kit";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildRegistry } from "../../src/calendar/composition.js";
import { registerAll } from "../../src/calendar/mcp/register.js";
import { POLICY } from "../../src/mcp/policy.js";

/** serve refuses to start while a registered tool is unclassified; this catches it before a deploy does. */
describe("calendar tool policy", () => {
  it("classifies every calendar tool, and free_busy and find_time as reads", () => {
    const names: string[] = [];
    const server = { registerTool: (name: string) => void names.push(name) } as unknown as McpServer;
    registerAll(server, buildRegistry({ CALENDAR_ROOT: mkdtempSync(join(tmpdir(), "calendar-policy-")) }));
    expect(names).toEqual(expect.arrayContaining(["agenda", "free_busy", "find_time"]));
    expect(names.filter((name) => !Object.hasOwn(POLICY, name))).toEqual([]);
    expect([POLICY["free_busy"], POLICY["find_time"]]).toEqual([{ access: "read" }, { access: "read" }]);
  });
});
