/**
 * Live smoke test: drives the built server over the real MCP protocol, as a
 * client would, against the real SPV. Everything in test/ needs no account.
 *
 *   npm run build -w @foreverworks/mcp-anaf-spv
 *   <ANAF_SPV_* variables> npx tsx scripts/smoke.ts                                  # stdio
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<file> npx tsx scripts/smoke.ts   # a running service
 *
 * What it does: health; session_status with a probe; list_messages, which
 * signs in by itself when no session works (SPV e-mails the account a code,
 * and the configured mail driver reads it); download_message of the newest
 * message, twice, to see the second find the first; list_document_types;
 * posting_dates (it reads the alert e-mails, not SPV); submit_contact_form as
 * a dry run for the account holder (it reads the contact form and sends
 * nothing); and an unknown argument, which must be
 * refused. All of that changes nothing at ANAF.
 *
 *   --validate <xml>     also validate_declaration of that D212 XML (a path the server's file roots
 *                        hold): ANAF's validator and the filing PDF, built here. Files nothing.
 *   --request "<type>"   also request_document of that type (e.g. "Obligatii de plata")
 *                        and await_reply for its answer. That REGISTERS A REQUEST at ANAF
 *                        (free, harmless, visible in the account's history).
 */
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const show = (label: string, value: unknown, max = 900): void => console.log(`${label}:`, JSON.stringify(value).slice(0, max));

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const option = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const requested = (): string | undefined => option("--request");

const main = async (): Promise<void> => {
  const client = await connectSmoke({ name: "smoke" });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const started = Date.now();
    const out = toolJson(await client.callTool({ name, arguments: args }));
    console.log(`  (${name}: ${Date.now() - started} ms)`);
    return out;
  };

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));
  check(tools.length === 15, "fifteen tools");

  const health = await call("health");
  show("\nhealth", health);
  check(health.ok === true, "health is ok");
  check(health.automatic_login === true, "the server can sign in by itself (a credential and a mail driver)");

  show("session_status", await call("session_status", { probe: health.session !== "none" }));

  const listed = await call("list_messages", { limit: 5 });
  show("\nlist_messages", listed);
  check(listed.ok === true && Array.isArray(listed.items), "list_messages answers a list (signing in if it had to)");
  check(typeof listed.total === "number" && listed.total >= listed.items.length, "total counts the whole list");
  const newest = listed.items?.[0];
  if (newest !== undefined) {
    check(/^[0-9a-f]{16}(-\d+)?$/.test(newest.key) && /^\d{4}-\d{2}-\d{2}T/.test(newest.posted_at), "a message has a key and an ISO posting time");
    const saved = await call("download_message", { key: newest.key, save_dir: "smoke" });
    show("download_message", saved);
    check(saved.ok === true && typeof saved.path === "string" && /^[0-9a-f]{64}$/.test(saved.sha256), "download_message saves the document with its SHA-256");
    const again = await call("download_message", { key: newest.key, save_dir: "smoke" });
    check(again.already_there === true && again.sha256 === saved.sha256, "SPV serves the same bytes again, and the second save finds the first");
  } else {
    console.log("  (the account's list is empty: download_message not exercised)");
  }

  const status = await call("session_status", { probe: true });
  check(status.signed_in === true && status.probed === true, "the session is alive after the reads");

  const types = await call("list_document_types");
  show("\nlist_document_types", types, 600);
  check(types.ok === true && Array.isArray(types.types) && types.types.length > 0, "the request form offers document types");

  const postings = await call("posting_dates", { limit: 5 });
  show("\nposting_dates", postings, 700);
  check(postings.ok === true && Array.isArray(postings.lines), "posting_dates reads SPV's alert e-mails");

  const holder = types.identities?.find((id: string) => /^\d{13}$/.test(id)) ?? types.cif;
  const dry = await call("submit_contact_form", { cif: holder, text: "Smoke test of a dry run; this is never sent." });
  show("\nsubmit_contact_form (dry run)", dry, 700);
  check(dry.ok === true && dry.sent === false && dry.message?.cif === holder, "the contact form is read back for the account holder and nothing is sent");

  const xml = option("--validate");
  if (xml !== undefined) {
    const validated = await call("validate_declaration", { xml, save_dir: "smoke" });
    show("\nvalidate_declaration", { ...validated, kit: undefined }, 900);
    check(validated.ok === true && validated.valid === true && validated.pdf?.embedded_xml_identical === true, "ANAF's validator takes the XML and the PDF carries it byte for byte");
  }

  const type = requested();
  if (type !== undefined) {
    const asked = await call("request_document", { type });
    show("\nrequest_document", asked);
    check(asked.ok === true && /^\d+$/.test(asked.request_id ?? ""), "request_document registers a request");
    if (asked.ok === true) {
      const reply = await call("await_reply", { request_id: asked.request_id, wait_seconds: 120, save_dir: "smoke" });
      show("await_reply", reply);
      check(reply.answered === true, "SPV answered within two minutes");
    }
  }

  // The kit makes every input strict: a misspelt argument is a protocol error naming it, not a default silently used.
  const unknown = (await client.callTool({ name: "list_messages", arguments: { limitt: 3 } })) as { isError?: boolean; content: { text: string }[] };
  check(unknown.isError === true && (unknown.content[0]?.text ?? "").includes("limitt"), "an unknown argument is refused, by name");

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
