/**
 * Live smoke test: spawns the BUILT server over stdio and drives it as a real
 * MCP client would, against the configuration in the environment
 * (ENABLE_BANKING_CONFIG, ENABLE_BANKING_KEY, ENABLE_BANKING_STATE_DIR), so
 * against a real consent.
 *
 *   npm run build -w @foreverworks/mcp-enable-banking
 *   npx tsx scripts/smoke.ts                  # read-only, the one stored consent
 *   npx tsx scripts/smoke.ts --label other    # read-only, a stored consent by label
 *   npx tsx scripts/smoke.ts --consent        # ALSO renews that consent: needs the account holder
 *
 * READ-ONLY by default: health, list_stored_sessions, list_accounts, and ONE
 * get_transactions over the last three days, on the first account. That last
 * one reaches the bank and counts against its daily allowance for unattended
 * reads (PSD2 allows about four per account a day, shared with anything else
 * reading the same consent), so do not loop this.
 *
 * `--consent` runs the consent flow for the bank, country and account type of
 * the stored consent: start_auth, a URL to open and approve in the bank's app,
 * then the redirect URL pasted here for complete_auth, which REPLACES that
 * consent under its label (the previous file goes to sessions.json.bak). Never
 * run it unasked.
 *
 * Session ids are not printed and IBANs only by their last four characters.
 */
import { createInterface } from "node:readline/promises";

import { type Client, connectSmoke } from "@foreverworks/mcp-kit";

const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const option = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

const LABEL = option("label", "");
/** The label argument, left out when none was given: the server then takes the one stored consent. */
const labelled = (): Payload => (LABEL === "" ? {} : { label: LABEL });

type Payload = Record<string, any>;
const parse = (result: unknown): Payload => JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "{}") as Payload;
const tail = (iban: unknown): string => (typeof iban === "string" ? `...${iban.slice(-4)}` : "(no IBAN)");
const isoDaysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const call = async (client: Client, name: string, args: Payload = {}): Promise<Payload> => {
  const t0 = Date.now();
  const out = parse(await client.callTool({ name, arguments: args }));
  console.log(`\n${name} (${Date.now() - t0} ms)${out["error"] ? ` -> ERROR ${out["error"].kind}: ${out["error"].message}` : ""}`);
  if (out["error"]?.remedy) console.log(`  remedy: ${out["error"].remedy}`);
  return out;
};

const readOnly = async (client: Client): Promise<boolean> => {
  const health = await call(client, "health");
  if (health["error"]) return false;
  console.log(`  ${health["applicationName"]} (${health["environment"]}), ${health["storedSessions"]} stored consent(s)`);

  const stored = await call(client, "list_stored_sessions");
  for (const s of stored["sessions"] ?? []) console.log(`  ${s.label}: ${s.bank?.name ?? "?"} ${s.psuType}, ${s.expires}`);

  const accounts = await call(client, "list_accounts", labelled());
  if (accounts["error"]) return false;
  console.log(`  ${accounts["label"]}: ${accounts["status"]}, ${accounts["count"]} account(s), ${accounts["expires"]}`);
  if (accounts["revoked"]) console.log(`  revoked by the bank: ${accounts["revoked"].length}`);

  const first = accounts["accounts"]?.[0];
  if (first === undefined) return true;
  const tx = await call(client, "get_transactions", { account_uid: first.uid, date_from: isoDaysAgo(3), date_to: isoDaysAgo(0) });
  if (tx["error"]) return false;
  console.log(`  ${tail(first.iban)} ${first.currency}: ${tx["count"]} booked row(s) since ${tx["dateFrom"]}`);
  return true;
};

const consent = async (client: Client): Promise<boolean> => {
  const stored = await call(client, "list_stored_sessions");
  const sessions: Payload[] = stored["sessions"] ?? [];
  const renewing = LABEL === "" ? (sessions.length === 1 ? sessions[0] : undefined) : sessions.find((s) => s.label === LABEL);
  if (renewing?.bank?.name === undefined) {
    console.log(`\nname the stored consent to renew with --label (stored: ${sessions.map((s) => s.label).join(", ") || "none"})`);
    return false;
  }
  const started = await call(client, "start_auth", {
    aspsp_name: renewing.bank.name,
    aspsp_country: renewing.bank.country,
    psu_type: renewing.psuType,
  });
  if (started["error"]) return false;
  console.log(`\nOpen this, approve in the bank's app and tick EVERY account:\n\n  ${started["url"]}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pasted = await rl.question("Paste the redirect URL (or just its code): ");
  rl.close();
  const done = await call(client, "complete_auth", { code_or_url: pasted, label: renewing.label });
  if (done["error"]) return false;
  console.log(`  stored as ${done["storedAs"]}, ${done["expires"]}; backup: ${done["backup"]}`);
  for (const a of done["accounts"] ?? []) console.log(`  ${tail(a.iban)} ${a.currency} ${a.name ?? ""}${a.detailsError ? ` (details: ${a.detailsError})` : ""}`);
  for (const w of done["formatWarnings"] ?? []) console.log(`  format: ${w}`);
  return true;
};

const main = async (): Promise<void> => {
  const client = await connectSmoke();
  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));

  const ok = flag("consent") ? (await consent(client)) && (await readOnly(client)) : await readOnly(client);
  await client.close();
  process.exit(ok ? 0 : 1);
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
