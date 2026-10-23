/**
 * Live smoke test against the running broker: status, then a lease on each platform that is up,
 * renewed and released clean. It takes real devices for a few seconds, so it is polite: it asks
 * as background priority and gives back whatever it got.
 *
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=/path/to/token npx tsx scripts/smoke.ts
 *
 * Without MCP_URL it spawns dist/index.js over stdio with this shell's DEVICES_* variables.
 */
import { connectSmoke, getDefaultEnvironment, toolJson } from "@foreverworks/mcp-kit";

const show = (label: string, value: unknown, max = 1500): void => console.log(`\n${label}:`, JSON.stringify(value).slice(0, max));

const main = async (): Promise<void> => {
  const devicesEnv = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[0].startsWith("DEVICES_") && e[1] !== undefined));
  const client = await connectSmoke({ env: { ...getDefaultEnvironment(), ...devicesEnv } });
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));
  const session = `smoke-${process.pid}`;

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));
  const status = await call("status", { session });
  show("status", status, 4000);

  for (const want of ["android", "ios"] as const) {
    const t = Date.now();
    const got = await call("acquire", { want, session, purpose: "smoke test, a few seconds", minutes: 2, priority: "background" });
    show(`acquire ${want} (${Date.now() - t} ms)`, got);
    if (got.status === "granted" || got.status === "held") {
      show(`renew ${want}`, await call("renew", { session, want, minutes: 2 }));
      show(`release ${want}`, await call("release", { session, want, state: "clean", note: "smoke test" }));
    }
  }
  await client.close();
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
