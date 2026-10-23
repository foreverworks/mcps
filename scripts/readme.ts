/**
 * A server README's tool tables, as check-docs holds them to the code: the
 * record of each tool's access class that the changelog checks compare
 * between releases.
 */
export const ACCESS = new Set(["read", "write", "money"]);

export type Row = { readonly tools: readonly string[]; readonly access: string; readonly line: number };

/** Table rows whose first cell names tools in backticks and one of whose cells is an access class. */
export const toolRows = (readme: string): readonly Row[] =>
  readme.split("\n").flatMap((line, i): Row[] => {
    if (!line.startsWith("|")) return [];
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const access = cells.map((c) => c.replace(/\*/g, "").trim()).find((c) => ACCESS.has(c));
    const tools = [...(cells[0] ?? "").matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1] as string);
    return access !== undefined && tools.length > 0 ? [{ tools, access, line: i + 1 }] : [];
  });

/** Each tool's access class, as the README's tables give it. */
export const accessOf = (readme: string): ReadonlyMap<string, string> => new Map(toolRows(readme).flatMap((row) => row.tools.map((tool) => [tool, row.access] as const)));

/** Whether a text names a tool in backticks, the way a changelog does. */
export const names = (text: string, tool: string): boolean => text.includes(`\`${tool}\``);

export type Change = { readonly tool: string; readonly before?: string; readonly after?: string };

/** What a person upgrading must be told: a class changed, or a write or money tool came or went. */
export const changesBetween = (before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): readonly Change[] => {
  const tools = [...new Set([...before.keys(), ...after.keys()])].sort();
  return tools.flatMap((tool): Change[] => {
    const was = before.get(tool);
    const now = after.get(tool);
    if (was === now) return [];
    if (was === undefined && now === "read") return [];
    if (now === undefined && was === "read") return [];
    return [{ tool, ...(was === undefined ? {} : { before: was }), ...(now === undefined ? {} : { after: now }) }];
  });
};

export const describeChange = (c: Change): string =>
  c.before === undefined ? `\`${c.tool}\` is new, ${c.after}` : c.after === undefined ? `\`${c.tool}\` is gone (it was ${c.before})` : `\`${c.tool}\` is now ${c.after} (it was ${c.before})`;
