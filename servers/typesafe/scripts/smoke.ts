/**
 * Live smoke test: drives the server as a real MCP client would, against the
 * real API. Costs a few thousand input tokens (well under a cent).
 *
 *   npm run build -w @foreverworks/mcp-typesafe
 *   TYPESAFE_API_KEY_FILE=... npx tsx scripts/smoke.ts
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<token file> npx tsx scripts/smoke.ts
 *
 * health, one ask with each question type, a five-row batch saved to the
 * outbox (TYPESAFE_OUTBOX_DIR, else the state folder), and one input failure
 * that never reaches TypeSafe.
 */
import { connectSmoke, getDefaultEnvironment, toolJson } from "@foreverworks/mcp-kit";

const typesafeEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[0].startsWith("TYPESAFE_") && entry[1] !== undefined),
);

const show = (label: string, value: unknown, max = 900): void => console.log(`\n${label}:`, JSON.stringify(value).slice(0, max));

const QUESTIONS = {
  urgent: { type: "noul", instructions: "Does the message convey that the matter is time-sensitive?" },
  team: {
    type: "choice",
    instructions: "Which team should handle this message?",
    criteria: { billing: "Payments, invoices, refunds, payouts", technical: "Bugs, outages, integrations", sales: "Pricing, upgrades, new accounts", none: "Not a support request" },
  },
  frustration: { type: "score", instructions: "How frustrated is the writer?", criteria: ["Calm", "Mildly annoyed", "Frustrated", "Very angry"] },
};

const main = async (): Promise<void> => {
  const client = await connectSmoke({ env: { ...getDefaultEnvironment(), ...typesafeEnv } });
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));

  const health = await call("health");
  show("health", health);
  if (health.error) {
    await client.close();
    process.exit(1);
  }

  let t = Date.now();
  const one = await call("ask", { state: "Help! My payouts have been failing for 3 days and nobody answers.", questions: QUESTIONS });
  show(`ask (${Date.now() - t} ms)`, one);
  t = Date.now();
  const rows = [
    "Your invoice INV-2291 was charged twice this month, please refund one.",
    "The API returns 500 on every POST since this morning, production is down!!",
    "Hi, what would the Team plan cost for 40 seats?",
    "Thanks for the quick fix yesterday, all good now.",
    "Webhook signatures stopped validating after your update. Annoying.",
  ].map((state, i) => ({ id: `row-${i}`, state }));
  const batch = await call("ask_batch", { items: rows, questions: QUESTIONS, save: true });
  show(`ask_batch (${Date.now() - t} ms wall)`, batch, 2500);
  // Refused by the tool's own schema, so the SDK answers with a protocol error rather than the envelope.
  const bad = (await client.callTool({ name: "ask", arguments: { state: "x", questions: { q: { type: "score", instructions: "?", criteria: ["only one"] } } } })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  show("bad question (refused, never sent)", { isError: bad.isError, text: bad.content[0]?.text.slice(0, 200) });
  await client.close();
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
