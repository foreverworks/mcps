/**
 * Live smoke test: drives the server as a real MCP client would, against the
 * real registers. One request per office per name, paced by the server.
 *
 *   npm run build -w @foreverworks/mcp-trademarks
 *   npx tsx scripts/smoke.ts [name ...]
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<token file> npx tsx scripts/smoke.ts
 *
 * health, then each name (default Lumen, Blue Night, Harbor) in classes 9,
 * 35 and 42, live marks, in every office; then get_mark on the first US mark
 * found, and one input failure that never reaches a register.
 */
import { connectSmoke, getDefaultEnvironment, toolJson } from "@foreverworks/mcp-kit";

const ownEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => /^(EUIPO_|TRADEMARKS_)/.test(entry[0]) && entry[1] !== undefined),
);

const show = (label: string, value: unknown, max = 4000): void => console.log(`\n${label}:`, JSON.stringify(value, null, 1).slice(0, max));

type Section = { office: string; searched: boolean; found?: number; counts?: unknown; marks?: { id: string; mark: string | null; relation: string; status: string; classes: number[]; owners: string[]; filed?: string }[]; reason?: string; error?: unknown };

const main = async (): Promise<void> => {
  const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["Lumen", "Blue Night", "Harbor"];
  const client = await connectSmoke({ env: { ...getDefaultEnvironment(), ...ownEnv } });
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));
  show("health", await call("health"));

  let firstUs: string | undefined;
  for (const name of names) {
    const t = Date.now();
    const result = (await call("search_marks", { name, classes: [9, 35, 42], limit: 8 })) as { offices: Section[] };
    console.log(`\n== ${name} (${Date.now() - t} ms)`);
    for (const s of result.offices) {
      if (!s.searched) {
        console.log(`  ${s.office}: NOT SEARCHED ${JSON.stringify(s.error ?? s.reason).slice(0, 220)}`);
        continue;
      }
      console.log(`  ${s.office}: found ${s.found}, counts ${JSON.stringify(s.counts)}`);
      for (const m of s.marks ?? []) console.log(`    ${m.relation.padEnd(9)} ${m.status.padEnd(10)} ${m.id} ${m.mark} [${m.classes.join(",")}] ${m.filed ?? ""} ${m.owners.join(" | ").slice(0, 80)}`);
      if (s.office === "US") firstUs ??= s.marks?.[0]?.id;
    }
  }

  if (firstUs !== undefined) show(`get_mark US ${firstUs}`, await call("get_mark", { office: "US", id: firstUs }), 1500);
  show("get_mark RO (unsupported)", await call("get_mark", { office: "RO", id: "123" }), 600);
  const bad = (await client.callTool({ name: "search_marks", arguments: { name: "tal*" } })) as { isError?: boolean; content: { text: string }[] };
  show("a pattern (refused, never sent)", { isError: bad.isError, text: bad.content[0]?.text.slice(0, 200) });
  await client.close();
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
