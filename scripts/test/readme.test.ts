import { describe, expect, it } from "vitest";

import { accessOf, changesBetween, describeChange } from "../readme.js";

const table = (rows: readonly (readonly [string, string])[]): string =>
  ["| Tool | Access | What it does |", "|---|---|---|", ...rows.map(([tool, access]) => `| \`${tool}\` | ${access === "money" ? "**money**" : access} | It does. |`)].join("\n");

describe("access changes between two READMEs", () => {
  it("reads each tool's class from the tool tables, rows that name several tools included", () => {
    expect(accessOf(`${table([["list_invoices", "read"]])}\n\n| \`cancel_invoice\` / \`delete_invoice\` | **money** | Both. |`)).toEqual(
      new Map([
        ["list_invoices", "read"],
        ["cancel_invoice", "money"],
        ["delete_invoice", "money"],
      ]),
    );
  });

  it("keeps what a person upgrading must be told: a new class, a new or removed write or money tool", () => {
    const before = accessOf(table([["get_invoice", "read"], ["delete_invoice", "write"], ["old_write", "write"], ["old_read", "read"]]));
    const after = accessOf(table([["get_invoice", "read"], ["delete_invoice", "money"], ["new_read", "read"], ["collect_invoice", "money"]]));
    expect(changesBetween(before, after).map(describeChange)).toEqual([
      "`collect_invoice` is new, money",
      "`delete_invoice` is now money (it was write)",
      "`old_write` is gone (it was write)",
    ]);
  });
});
