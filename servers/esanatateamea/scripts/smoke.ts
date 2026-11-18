/**
 * Live smoke test: drives the built server over the real MCP protocol, as a
 * client would, against the real portal. Everything in test/ needs no
 * account; this needs one.
 *
 *   npm run build -w @foreverworks/mcp-esanatateamea
 *   ESANATATEAMEA_STATE_DIR=<dir> <password settings> npx tsx scripts/smoke.ts            # stdio
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<file> npx tsx scripts/smoke.ts     # a running service
 *
 * Without a flag it only reads: health, session_status (probing once, which
 * signs in with the configured password when no session is stored), then
 * every read tool, checking each answer's shape. With `--sign-in` it first
 * runs the password leg from the start (begin_login with method password),
 * which with a code source configured must finish by itself.
 *
 * It prints counts and field names, never the records themselves: what the
 * portal holds is the person's health data.
 */
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

/** An answer's outline: its keys, and for each list its length. No value is printed. */
const outline = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return typeof value;
  return Object.entries(value as Record<string, unknown>)
    .map(([key, v]) => (Array.isArray(v) ? `${key}[${v.length}]` : typeof v === "object" && v !== null ? `${key}{}` : key))
    .join(", ");
};

const errorOf = (out: { error?: { kind?: string; status?: number; message?: string } }): string =>
  out.error === undefined ? "" : ` (${out.error.kind ?? "?"}${out.error.status === undefined ? "" : ` ${out.error.status}`}: ${out.error.message ?? ""})`;

const main = async (): Promise<void> => {
  const signIn = process.argv.includes("--sign-in");
  const client = await connectSmoke();
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const started = Date.now();
    const out = toolJson(await client.callTool({ name, arguments: args }));
    console.log(`  ${name}: ${Date.now() - started} ms; ${outline(out)}${errorOf(out)}`);
    return out;
  };

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));
  check(tools.length === 13, "thirteen tools");

  const health = await call("health");
  check(health.ok === true, "health is ok");
  console.log(`  session ${health.session}, password from ${health.password_sign_in?.kind}, code from ${health.authenticator_code?.kind}`);

  if (signIn) {
    const begun = await call("begin_login", { method: "password" });
    check(begun.connected === true && begun.via === "password", "the password leg signs in by itself");
  }

  const status = await call("session_status", { probe: true });
  check(status.connected === true, "a session works");
  check(typeof status.who?.email === "string" || typeof status.who?.username === "string", "session_status names the account");

  if (status.connected === true) {
    const insurance = await call("get_insurance");
    check(insurance.ok === true && typeof insurance.insured === "string", "get_insurance says whether the person is insured");
    check(Array.isArray(insurance.packages) && Array.isArray(insurance.history), "get_insurance has the packages and the history");

    const prescriptions = await call("list_prescriptions");
    check(prescriptions.ok === true && Array.isArray(prescriptions.prescribed) && Array.isArray(prescriptions.released), "list_prescriptions answers both lists");

    const services = await call("list_reimbursed_services", { size: 20 });
    check(services.ok === true && typeof services.summary?.total_reimbursed === "string" && Array.isArray(services.items), "list_reimbursed_services answers rows and an exact total");

    const documents = await call("list_medical_documents");
    check(documents.ok === true && Array.isArray(documents.items), "list_medical_documents answers a list");
    const first = documents.items?.[0];
    if (first !== undefined) {
      const one = await call("get_medical_document", { id: first.id });
      check(one.ok === true && Array.isArray(one.document?.sections), "get_medical_document has sections");
      const saved = await call("download_medical_document", { id: first.id });
      check(saved.ok === true && typeof saved.file?.sha256 === "string" && saved.file.size > 0, "download_medical_document saves a PDF");
    } else {
      // No document to read: an id that is none must still reach the portal with the session (a refused
      // one is needs_login) and come back as the portal's answer to an unknown id, a 500 that says so.
      console.log("  (no medical documents on the account: get_medical_document and download_medical_document asked for an id that is none)");
      for (const name of ["get_medical_document", "download_medical_document"]) {
        const out = await call(name, { id: "00000000-0000-0000-0000-000000000000" });
        const unknownId = out.error?.kind === "not_found" || (out.error?.kind === "api" && out.error.status === 500 && String(out.error.message).includes("list_medical_documents"));
        check(unknownId, `${name} reaches the portal and answers an unknown id as one`);
      }
    }

    const emergency = await call("get_emergency_summary", { pdf: true });
    check(emergency.ok === true && Array.isArray(emergency.entries) && Array.isArray(emergency.contacts) && Array.isArray(emergency.advance_directives), "get_emergency_summary answers its three lists");
    check(typeof emergency.file?.sha256 === "string" && emergency.file.size > 0, "get_emergency_summary saves the portal's PDF");

    for (const tab of ["upcoming", "waiting", "past", "cancelled"]) {
      const appointments = await call("list_appointments", { tab });
      check(appointments.ok === true && Array.isArray(appointments.items) && typeof appointments.counts === "object", `list_appointments ${tab} answers a list and the counts`);
    }
  }

  // The kit makes every input strict: a misspelt argument is a protocol error naming it, not a default silently used.
  const unknown = (await client.callTool({ name: "list_prescriptions", arguments: { fromm: "2026-01-01" } })) as { isError?: boolean; content: { text: string }[] };
  check(unknown.isError === true && (unknown.content[0]?.text ?? "").includes("fromm"), "an unknown argument is refused, by name");

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
