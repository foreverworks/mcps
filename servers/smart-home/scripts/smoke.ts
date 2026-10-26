/**
 * Live smoke test: drives the server as a real MCP client would, against the
 * blasters in its catalog. By default it only reads: nothing is sent and
 * nothing listens.
 *
 *   npm run build -w @foreverworks/mcp-smart-home
 *   SMART_HOME_CONFIG_FILE=<catalog.json> npx tsx scripts/smoke.ts
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<token file> npx tsx scripts/smoke.ts
 *
 * health, status (every blaster online and unlocked), devices. With
 * --press <device>/<button> it then presses that button once through
 * press_confirmed, and with --learn it listens once for a remote: both act on
 * a device in someone's home, so pass them only when the person there expects
 * it.
 */
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const argAfter = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i < 0 ? undefined : process.argv[i + 1];
};

const main = async (): Promise<void> => {
  const client = await connectSmoke({ name: "smoke" });
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));
  const health = await call("health");
  console.log("health:", JSON.stringify(health));
  check(health.ok === true, "health is ok");
  const status = await call("status");
  console.log("status:", JSON.stringify(status));
  for (const b of status.blasters ?? []) {
    check(b.online === true && b.error === undefined, `blaster ${b.name} answers (${b.model ?? b.error?.kind})`);
    check(b.locked === false, `blaster ${b.name} is unlocked`);
  }
  const devices = await call("devices");
  console.log("devices:", (devices.devices ?? []).map((d: { name: string; buttons: unknown[] }) => `${d.name} (${d.buttons.length} buttons)`).join(", "));
  check(Array.isArray(devices.devices), "the catalog reads");

  const target = argAfter("--press");
  if (target !== undefined) {
    const [device, button] = target.split("/");
    const pressed = await call("press_confirmed", { device, button });
    console.log("press:", JSON.stringify(pressed));
    check(pressed.sent === true, `pressed ${target}`);
  }
  if (process.argv.includes("--learn")) {
    console.log("learn: press one button on the remote, pointed at the blaster");
    const learned = await call("learn", { seconds: 30 });
    console.log("learn:", JSON.stringify(learned));
    check(learned.protocol !== undefined, "a press was heard");
  }

  await client.close();
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nsmoke: every check passed");
};

main().catch((error: unknown) => {
  console.error("smoke failed:", error);
  process.exit(1);
});
