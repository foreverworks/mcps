/**
 * Live smoke test: drives the server as a real MCP client would, against the
 * Home Assistant in its environment. By default it only reads: nothing runs.
 *
 *   npm run build -w @foreverworks/mcp-home-assistant
 *   HOME_ASSISTANT_URL=<address> HOME_ASSISTANT_TOKEN_FILE=<token file> npx tsx scripts/smoke.ts
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<token file> npx tsx scripts/smoke.ts
 *
 * health (ok, and the WebSocket signs in), list_entities, get_states of the
 * first entity, list_areas, list_actions, history and logbook of the last
 * hour, and a template. With --action <domain.service> --entity <entity_id>
 * it then runs that action once through call_action_confirmed: it acts on a
 * home, so pass it only when the people there expect it.
 *
 * Run it once with a wrong token first if you want to see the refusal: the
 * server answers auth and sends nothing more, which costs one failed login.
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
  console.log("health:", JSON.stringify({ ...health, entities_per_domain: undefined }));
  check(health.ok === true, "health is ok");
  check(health.websocket === "ok", "the WebSocket API signs in");
  if (health.ok !== true) {
    await client.close();
    console.error("\nhealth is not ok; stopping before anything else is sent");
    process.exit(1);
  }

  const listed = await call("list_entities", { limit: 5 });
  console.log("list_entities:", JSON.stringify(listed));
  check(Array.isArray(listed.entities) && listed.total > 0, "entities are listed");
  const first = listed.entities?.[0]?.entity_id as string | undefined;
  if (first !== undefined) {
    const states = await call("get_states", { entity_ids: [first], attributes: false });
    check(states.states?.[0]?.entity_id === first, `get_states reads ${first}`);
    const history = await call("history", { entity_ids: [first], hours: 1, limit: 5 });
    check(Array.isArray(history.entities), "history reads the recorder");
  }
  const areas = await call("list_areas", { entities: false });
  console.log("list_areas:", (areas.areas ?? []).map((a: { name: string; entity_count: number }) => `${a.name} (${a.entity_count})`).join(", "));
  check(Array.isArray(areas.areas), "the registries read");
  const actions = await call("list_actions");
  check(Array.isArray(actions.domains) && actions.domains.length > 0, `${actions.domains?.length ?? 0} action domains`);
  const logbook = await call("logbook", { hours: 1, limit: 5 });
  check(Array.isArray(logbook.entries), "the logbook reads");
  const template = await call("render_template", { template: "{{ states | count }}" });
  check(typeof template.result === "string", `a template renders (${template.result ?? template.error?.kind})`);

  const action = argAfter("--action");
  const entity = argAfter("--entity");
  if (action !== undefined && entity !== undefined) {
    const [domain, service] = action.split(".");
    const ran = await call("call_action_confirmed", { domain, service, target: { entity_id: entity } });
    console.log("call_action_confirmed:", JSON.stringify(ran));
    check(ran.error === undefined, `${action} ran on ${entity}`);
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
