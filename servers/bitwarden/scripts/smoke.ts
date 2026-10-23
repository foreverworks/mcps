/**
 * Live smoke test: spawns the built server over stdio and drives it as a real
 * MCP client would, against the real account.
 *
 *   npm run build -w @foreverworks/mcp-bitwarden
 *   BITWARDEN_STATE_DIR=<empty dir> BITWARDEN_CLIENT_ID_FILE=... BITWARDEN_CLIENT_SECRET_FILE=... \
 *   BITWARDEN_MASTER_PASSWORD_FILE=... npx tsx scripts/smoke.ts [--write]
 *
 * READ-ONLY BY DEFAULT: health, find_logins, and one input failure that never
 * reaches Bitwarden. `--write` also creates a login named "mcp smoke test",
 * rotates its password, checks the CLI kept the old one in the item's history
 * (get_password previous), appends to its notes and reads its TOTP code, then
 * creates a secure note "mcp smoke test note" with a typed hidden field and
 * reads it back with get_field; nothing here deletes, so remove both in the web
 * vault afterwards. No secret is printed: only lengths and comparisons.
 */
import { Client, StdioClientTransport } from "@foreverworks/mcp-kit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (result: unknown): any => JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "{}");
const show = (label: string, value: unknown, max = 500): void => console.log(`${label}:`, JSON.stringify(value).slice(0, max));

const main = async (): Promise<void> => {
  const client = new Client({ name: "smoke", version: "1.0.0" });
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env }));
  const call = async (name: string, args: Record<string, unknown> = {}) => parse(await client.callTool({ name, arguments: args }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));

  const started = Date.now();
  const health = await call("health");
  show(`\nhealth (${Date.now() - started} ms, includes login and unlock)`, health);
  if (health.error) {
    await client.close();
    process.exit(1);
  }
  show("\nfind_logins", await call("find_logins", { limit: 5 }));
  show("\nbad id (input, never sent)", await call("get_login", { id: "not-an-id" }));

  if (process.argv.includes("--write")) {
    const created = await call("create_login", {
      name: "mcp smoke test",
      url: "https://example.com/login",
      username: "smoke@example.com",
      totp_secret: "JBSWY3DPEHPK3PXP",
    });
    show("\ncreate_login", created);
    const pw = await call("get_password", { id: created.id });
    console.log("\nget_password: length", String(pw.password ?? "").length);
    const rotated = await call("update_login", { id: created.id, rotate_password: true, length: 30 });
    show("\nupdate_login rotate", { passwordChanged: rotated.passwordChanged, error: rotated.error });
    const pw2 = await call("get_password", { id: created.id });
    console.log("get_password after rotate: length", String(pw2.password ?? "").length, "differs", pw2.password !== pw.password);
    const before = await call("get_password", { id: created.id, previous: true });
    console.log("get_password previous: is the one replaced", before.password === pw.password, before.error ? JSON.stringify(before.error) : "");
    const appended = await call("update_login", { id: created.id, append_notes: "smoke: appended line" });
    show("update_login append_notes", { error: appended.error });
    const code = await call("totp", { id: created.id });
    console.log("totp: digits", String(code.code ?? "").length, "secondsLeft", code.secondsLeft);
    show("\nfind_logins by url", await call("find_logins", { url: "https://example.com" }));
    const secret = `smoke-${"x".repeat(1500)}\nsecond line\n`;
    const note = await call("create_note", { name: "mcp smoke test note", notes: "made by the smoke test", fields: [{ name: "token", value: secret }] });
    show("\ncreate_note", { id: note.id, fields: note.fields, error: note.error });
    const field = await call("get_field", { id: note.id, field: "token" });
    console.log("get_field: the value stored is the one sent", field.value === secret, field.error ? JSON.stringify(field.error) : "");
  }
  await client.close();
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
