/**
 * The server as a client sees it, through the kit's guard, end to end against
 * a fake SPV and fake mail and vault MCP servers: the sign-in it does by
 * itself (each mail driver, and by hand), a session SPV ends, the reads, the
 * downloads, sync, and the requests, with what each failure tells an agent.
 */
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { needsPerson } from "@foreverworks/mcp-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DukPort } from "../src/app/ports.js";
import { embeddedFiles } from "../src/infra/pdf.js";
import { policyFor } from "../src/mcp/policy.js";
import { d212, fakeDuk } from "./fakes/duk.js";
import { googleMailServer, inMemory, makeMailbox, textMailServer, vaultServer } from "./fakes/mcp.js";
import { CNP, COMPANY, makeFakeSpv, pdf, replyRow, ROWS } from "./fakes/spv.js";
import { type FakeFiling, makeFakeStare, STARE_ORIGIN } from "./fakes/stare.js";
import { connected, makeClock, parse, stateDir } from "./helpers.js";

const VAULT = { ANAF_SPV_VAULT_MCP_URL: "http://127.0.0.1:9/mcp", ANAF_SPV_VAULT_MCP_TOKEN: "vault-token-0123456789", ANAF_SPV_VAULT_ITEM: "item-1" };
const MAIL = { ANAF_SPV_MAIL_MCP_URL: "http://127.0.0.1:9/mcp", ANAF_SPV_MAIL_MCP_TOKEN: "mail-token-0123456789", ANAF_SPV_MAIL_ACCOUNT: "personal" };

/** SPV, a mailbox it e-mails codes to (with one old code already in it), a vault, and the server over them. */
const world = async (
  options: {
    readonly mail?: "google" | "text" | "none" | "silent";
    readonly env?: NodeJS.ProcessEnv;
    readonly spv?: Parameters<typeof makeFakeSpv>[0]["refuse"];
    readonly duk?: DukPort;
    readonly filings?: FakeFiling[];
  } = {},
) => {
  const clock = makeClock();
  const box = makeMailbox(clock.now);
  box.deliverCode("111111");
  clock.clock.t += 600_000;
  const mailKind = options.mail ?? "google";
  const spv = makeFakeSpv({ mail: (code) => (mailKind === "silent" ? undefined : box.deliverCode(code)), ...(options.spv ? { refuse: options.spv } : {}) });
  const calls: string[] = [];
  const env = { ANAF_SPV_STATE_DIR: stateDir(), ...VAULT, ...(mailKind === "none" ? {} : MAIL), ...options.env };
  const transportFor = inMemory({
    vault: () => vaultServer(calls),
    mail: () => (mailKind === "text" ? textMailServer(box, calls) : googleMailServer(box, calls)),
  });
  const stare = makeFakeStare(options.filings);
  const fetch = ((input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
    new URL(input instanceof Request ? input.url : String(input)).origin === STARE_ORIGIN ? stare.fetch(input, init) : spv.fetch(input, init)) as typeof globalThis.fetch;
  const server = await connected({ env, fetch, transportFor, clock, ...(options.duk === undefined ? {} : { duk: options.duk }) });
  return { ...server, spv, stare, box, calls, clock, env };
};

describe("signing in by itself", () => {
  it("signs in on the first read, with the password from the vault and the newest code from a google-shaped mailbox", async () => {
    const w = await world();
    const listed = await w.call("list_messages");
    expect(listed.ok).toBe(true);
    expect(listed.total).toBe(3);
    expect(listed.items[0]).toMatchObject({ type: "DECIZIE", cif: CNP, posted_at: "2026-03-03T10:00:00+02:00", archived_at: "2026-05-04T10:00:00+03:00" });
    expect(listed.items[2]).toMatchObject({ type: "PLATA", request_id: "44000001", posted_at: "2021-01-15T08:00:00+02:00" });
    expect(listed.types).toEqual({ DECIZIE: 1, "RASPUNS SOLICITARE": 1, PLATA: 1 });
    expect(w.spv.state).toMatchObject({ passwordPosts: 1, codePosts: 1 });
    expect(w.calls).toContain("get_password item-1");
    expect(w.calls).toContain("search_threads personal");
    expect(w.calls.some((c) => c.startsWith("get_thread thread-1"))).toBe(true);

    const status = await w.call("session_status", { probe: true });
    expect(status).toMatchObject({ signed_in: true, probed: true, session: { username: "ana.popescu" } });
    await w.close();
  });

  it("reads the code through ANY mail server's search tool, by text", async () => {
    const w = await world({ mail: "text" });
    expect((await w.call("list_messages")).ok).toBe(true);
    expect(w.spv.state.codePosts).toBe(1);
    const searches = w.calls.filter((c) => c.startsWith("search_emails"));
    expect(searches.length).toBeGreaterThanOrEqual(2);
    expect(searches[0]).toContain('"query":"from:Autentificare.SpatiuPrivat@anaf.ro subject:\\"Cod de siguranta\\" newer_than:1d"');
    await w.close();
  });

  it("asks for a template when the search tool needs more than a query, before anything reaches SPV", async () => {
    const clock = makeClock();
    const box = makeMailbox(clock.now);
    const spv = makeFakeSpv({ mail: box.deliverCode });
    const calls: string[] = [];
    const transportFor = inMemory({ vault: () => vaultServer(calls), mail: () => textMailServer(box, calls, { tool: "find_mail", requiresFolder: true }) });
    const bare = await connected({ env: { ANAF_SPV_STATE_DIR: stateDir(), ...VAULT, ...MAIL }, fetch: spv.fetch, transportFor, clock });
    const failed = await bare.call("list_messages");
    expect(failed.error).toMatchObject({ kind: "config" });
    expect(failed.error.message).toContain("folder");
    expect(failed.error.message).toContain("ANAF_SPV_MAIL_SEARCH_ARGS");
    expect(spv.state.passwordPosts).toBe(0);
    await bare.close();

    const templated = await connected({
      env: { ANAF_SPV_STATE_DIR: stateDir(), ...VAULT, ...MAIL, ANAF_SPV_MAIL_SEARCH_ARGS: '{"query":"{{query}}","folder":"INBOX"}' },
      fetch: spv.fetch,
      transportFor,
      clock,
    });
    expect((await templated.call("list_messages")).ok).toBe(true);
    expect(calls.some((c) => c.includes('"folder":"INBOX"'))).toBe(true);
    await templated.close();
  });

  it("without a mail server, waits for complete_login and says how", async () => {
    const w = await world({ mail: "none" });
    const health = await w.call("health");
    expect(health).toMatchObject({ code: { driver: "manual" }, automatic_login: false });

    const waiting = await w.call("list_messages");
    expect(waiting.error).toMatchObject({ kind: "needs_login", reason: "awaiting_code" });
    expect(waiting.error.remedy).toContain("complete_login");
    expect(waiting.error.expires_at).toBe("2026-10-12T15:15:00+03:00");
    expect((await w.call("session_status")).awaiting_code_until).toBe("2026-10-12T15:15:00+03:00");

    expect((await w.call("complete_login", { code: "12 34" })).error).toMatchObject({ kind: "login_refused", step: "code" });
    expect((await w.call("complete_login", { code: "123456" })).error).toMatchObject({ kind: "input" });

    expect((await w.call("login")).awaiting_code).toBe(true);
    const done = await w.call("complete_login", { code: w.spv.state.codes.at(-1) });
    expect(done).toMatchObject({ ok: true, signed_in: true });
    expect((await w.call("list_messages")).total).toBe(3);
    expect(w.spv.state.passwordPosts).toBe(2);
    await w.close();
  });

  it("when the code does not come in time, keeps the sign-in open for complete_login", async () => {
    const w = await world({ mail: "silent" });
    const failed = await w.call("list_messages");
    expect(failed.error).toMatchObject({ kind: "needs_login", reason: "code_not_received" });
    expect(failed.error.message).toContain("90 s");
    expect((await w.call("complete_login", { code: w.spv.state.codes.at(-1) })).signed_in).toBe(true);
    expect((await w.call("list_messages")).ok).toBe(true);
    await w.close();
  });

  it("refuses an expired pending sign-in", async () => {
    const w = await world({ mail: "none" });
    await w.call("login");
    w.clock.clock.t += 301_000;
    expect((await w.call("complete_login", { code: w.spv.state.codes.at(-1) })).error).toMatchObject({ kind: "needs_login", reason: "pending_expired" });
    await w.close();
  });

  it("reports a refused password in SPV's words and does not retry it", async () => {
    const w = await world({ env: { ANAF_SPV_VAULT_ITEM: "item-1", ANAF_SPV_USERNAME: "someone.else" } });
    const failed = await w.call("list_messages");
    expect(failed.error).toMatchObject({ kind: "login_refused", step: "password" });
    expect(failed.error.message).toContain("Autentificare esuata");
    expect(failed.error.remedy).toContain("lock the account");
    expect(w.spv.state.passwordPosts).toBe(1);
    await w.close();
  });

  it("signs in again once when SPV ends the session, and two callers make SPV send one code", async () => {
    const w = await world();
    await w.call("list_messages");
    w.spv.expireAll();
    const [a, b] = await Promise.all([w.call("list_messages"), w.call("list_messages", { type: "plata" })]);
    expect(a.total).toBe(3);
    expect(b.matched).toBe(1);
    expect(w.spv.state.passwordPosts).toBe(2);
    expect(w.spv.state.codePosts).toBe(2);
    await w.close();
  });

  it("keeps the session in 0600 files and forgets it at logout", async () => {
    const w = await world();
    await w.call("login");
    const file = join(String(w.env["ANAF_SPV_STATE_DIR"]), "session.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toContain("correct horse");
    expect((await w.call("login")).already).toBe(true);
    expect(await w.call("logout")).toMatchObject({ signed_in: false, forgot: true });
    expect((await w.call("session_status")).signed_in).toBe(false);
    await w.close();
  });
});

describe("messages", () => {
  it("filters by type, dates, request and words", async () => {
    const w = await world();
    expect((await w.call("list_messages", { type: "Raspuns solicitare" })).items.map((i: { request_id: string }) => i.request_id)).toEqual(["190000001"]);
    expect((await w.call("list_messages", { since: "2026-01-01" })).matched).toBe(2);
    expect((await w.call("list_messages", { until: "2021-01-15" })).matched).toBe(1);
    expect((await w.call("list_messages", { request_id: "44000001" })).items[0].type).toBe("PLATA");
    expect((await w.call("list_messages", { text: "ACCESORII" })).matched).toBe(1);
    const limited = await w.call("list_messages", { limit: 1 });
    expect(limited).toMatchObject({ matched: 3, more: 2 });
    await w.close();
  });

  it("downloads SPV's bytes into the outbox, named by date and type, once", async () => {
    const w = await world();
    const plata = (await w.call("list_messages", { type: "PLATA" })).items[0];
    const saved = await w.call("download_message", { key: plata.key, save_dir: "2021" });
    expect(saved.path.endsWith("/downloads/2021/2021-01-15_plata_44000001_spv_plati.pdf")).toBe(true);
    const expected = ROWS[2]?.bytes ?? new Uint8Array();
    expect(saved).toMatchObject({ already_there: false, bytes: expected.byteLength, sha256: createHash("sha256").update(expected).digest("hex"), content_type: "application/pdf" });
    expect(statSync(saved.path).mode & 0o777).toBe(0o640);
    const again = await w.client.callTool({ name: "download_message", arguments: { key: plata.key, save_dir: "2021" } });
    expect(JSON.parse((again.content as unknown as [{ text: string }])[0].text).already_there).toBe(true);
    // The file is linked after the JSON, already there or not, for a client to open without parsing it.
    expect((again.content as unknown[]).slice(1)).toEqual([
      { type: "resource_link", uri: `file://${saved.path}`, name: "2021-01-15_plata_44000001_spv_plati.pdf", mimeType: "application/pdf", size: expected.byteLength },
    ]);
    expect((await w.call("download_message", { key: plata.key, save_dir: "/etc" })).error).toMatchObject({ kind: "input" });
    expect((await w.call("download_message", { key: "0000000000000000" })).error).toMatchObject({ kind: "not_found" });
    await w.close();
  });

  it("signs in again and downloads anyway when the session ends between the listing and the download", async () => {
    const w = await world();
    const plata = (await w.call("list_messages", { type: "PLATA" })).items[0];
    w.spv.state.expireBeforeDownload = true;
    const saved = await w.call("download_message", { key: plata.key });
    expect(saved).toMatchObject({ ok: true, file_name: "44000001_spv_plati.pdf" });
    expect(w.spv.state.passwordPosts).toBe(2);
    await w.close();
  });

  // SPV's download link is a row's position in the list the session last rendered,
  // so a listing by another call between this call's listing and its download shifted the rows.
  it("saves each message's own document when calls overlap while SPV posts a new one", async () => {
    const w = await world();
    const items = (await w.call("list_messages")).items as { key: string; type: string }[];
    const answer = items.find((i) => i.type === "RASPUNS SOLICITARE");
    const plata = items.find((i) => i.type === "PLATA");
    w.spv.state.arriving.push(replyRow("192000777", "12.10.2026 15:01:00"));
    w.spv.state.latencyMs = 5;
    const [a, b] = await Promise.all([w.call("download_message", { key: answer?.key }), w.call("download_message", { key: plata?.key })]);
    expect(a).toMatchObject({ ok: true, file_name: "190000001_Obligatii_de_plata.pdf", message: { request_id: "190000001" } });
    expect(b).toMatchObject({ ok: true, file_name: "44000001_spv_plati.pdf", message: { request_id: "44000001" } });
    await w.close();
  });

  it("answers parallel await_reply calls each with its own request's document", async () => {
    const w = await world();
    w.spv.reply("192000001", "12.10.2026 15:01:00");
    w.spv.reply("192000002", "12.10.2026 15:01:00");
    w.spv.state.arriving.push(replyRow("192000003", "12.10.2026 15:01:01"));
    w.spv.state.latencyMs = 5;
    const ids = ["192000001", "192000002", "192000003"];
    const answers = await Promise.all(ids.map((id) => w.call("await_reply", { request_id: id, wait_seconds: 30 })));
    for (const [i, id] of ids.entries()) {
      expect(answers[i]).toMatchObject({ ok: true, answered: true, file_name: `${id}_Obligatii_de_plata.pdf`, message: { request_id: id } });
      expect(readFileSync(answers[i].path, "utf8")).toContain(`raspuns ${id}`);
    }
    await w.close();
  });

  it("refuses, and saves nothing, a file SPV names for another message", async () => {
    const w = await world();
    const downloads = join(w.env.ANAF_SPV_STATE_DIR ?? "", "downloads");
    const saved = () => (existsSync(downloads) ? readdirSync(downloads) : []);
    const row = { posted: "01.10.2026 10:00:00", archived: "01.12.2026 10:00:00", details: `Obligatii de plata pentru CNP ${CNP}`, bytes: pdf("x") };
    w.spv.rows.push(
      { ...row, type: "RASPUNS SOLICITARE", requestId: "190000002", fileName: "190000001_Obligatii_de_plata.pdf" },
      { ...row, type: "DECIZIE", details: `Decizie pentru CIF ${CNP}`, fileName: "44000001_spv_plati.pdf" },
      // SPV names the bank report F2102 by its type only, with no id to check.
      { ...row, type: "RASPUNS SOLICITARE", requestId: "190000003", details: `raport F2102_SPV pentru banca avand CUI=${CNP}`, fileName: "F2102_SPV_ANAF_f2102.xml.pdf" },
    );
    const keyOf = async (args: Record<string, string>) => (await w.call("list_messages", args)).items[0].key as string;

    const foreign = await w.call("download_message", { key: await keyOf({ request_id: "190000002" }) });
    expect(foreign.error).toMatchObject({ kind: "wrong_document" });
    expect(foreign.error.message).toContain("190000001");
    const decision = await w.call("download_message", { key: await keyOf({ type: "DECIZIE", text: "Decizie pentru" }) });
    expect(decision.error).toMatchObject({ kind: "wrong_document" });
    expect(decision.error.message).toContain("44000001");
    expect(saved()).toEqual([]);

    expect(await w.call("download_message", { key: await keyOf({ request_id: "190000003" }) })).toMatchObject({ ok: true, file_name: "F2102_SPV_ANAF_f2102.xml.pdf" });
    const synced = await w.call("sync_messages");
    expect(synced.error).toMatchObject({ kind: "wrong_document" });
    await w.close();
  });

  it("syncs every message once, oldest first, and picks up new ones", async () => {
    const w = await world();
    const first = await w.call("sync_messages");
    expect(first.saved.map((s: { message: { type: string } }) => s.message.type)).toEqual(["PLATA", "RASPUNS SOLICITARE", "DECIZIE"]);
    expect(first).toMatchObject({ listed: 3, already_saved: 0 });
    const again = await w.call("sync_messages");
    expect(again).toMatchObject({ already_saved: 3, saved: [] });
    w.spv.reply("192000999", "12.10.2026 15:01:00");
    const more = await w.call("sync_messages", { limit: 1 });
    expect(more.saved).toHaveLength(1);
    expect(more.saved[0].message.request_id).toBe("192000999");
    await w.close();
  });

  it("tells a client that asked each document saved, out of how many", async () => {
    const w = await world();
    const heard: unknown[] = [];
    const result = await w.client.callTool({ name: "sync_messages", arguments: {} }, { onprogress: (p) => void heard.push(p) });
    expect(parse(result).saved).toHaveLength(3);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(heard[0]).toEqual({ progress: 0, total: 3, message: "3 of 3 new documents to save" });
    expect(heard.at(-1)).toEqual({ progress: 3, total: 3, message: "3 of 3 documents saved" });
    await w.close();
  });
});

describe("requests", () => {
  it("lists the types the live form offers, with the fields each takes", async () => {
    const w = await world();
    const types = await w.call("list_document_types");
    expect(types.identities).toEqual([CNP]);
    expect(types.types).toContainEqual({ type: "Duplicat declaratie unica", requires: ["year"], accepts: ["year"], month_set_by_spv: 12, note: expect.any(String) });
    expect(types.types).toContainEqual({ type: "Obligatii de plata", requires: [], accepts: [] });
    expect(types.types.map((t: { type: string }) => t.type)).not.toContain("Bilant anual");
    await w.close();
  });

  it("registers a request with exactly the fields its type takes, then waits for the reply", async () => {
    const w = await world();
    const asked = await w.call("request_document", { type: "obligatii de plata" });
    expect(asked).toMatchObject({ ok: true, request_id: "192000001", type: "Obligatii de plata", cif: CNP });
    expect(w.spv.state.requests[0]).toMatchObject({ "form1:cui": CNP, "form1:TipDocument": "Obligatii de plata", "form1:AnRaportare": "", "form1:j_id1809650055_6bdd1248": "Trimite" });
    expect(w.spv.state.requests[0]).not.toHaveProperty("form1:LunaRaportare");

    expect(await w.call("await_reply", { request_id: "192000001", wait_seconds: 0 })).toMatchObject({ answered: false });
    w.spv.reply("192000001", "12.10.2026 15:02:00");
    const reply = await w.call("await_reply", { request_id: "192000001", wait_seconds: 10 });
    expect(reply).toMatchObject({ answered: true, already_there: false, message: { request_id: "192000001" } });
    expect(reply.path).toContain("2026-10-12_raspuns-solicitare_192000001_Obligatii_de_plata.pdf");
    await w.close();
  });

  it("tells a client that asked how long it has waited", async () => {
    const w = await world();
    await w.call("request_document", { type: "obligatii de plata" });
    const heard: { progress: number; total?: number | undefined; message?: string | undefined }[] = [];
    const quiet = await w.client.callTool({ name: "await_reply", arguments: { request_id: "192000001", wait_seconds: 7 } }, { onprogress: (p) => void heard.push(p) });
    expect(parse(quiet)).toMatchObject({ answered: false });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(heard[0]).toMatchObject({ total: 7, message: expect.stringContaining("no answer to request 192000001 after") });
    expect(heard.map((h) => h.progress)).toEqual([...heard.map((h) => h.progress)].sort((a, b) => a - b));
    await w.close();
  });

  it("checks a request's fields before anything is sent", async () => {
    const w = await world();
    expect((await w.call("request_document", { type: "Duplicat declaratie unica" })).error.message).toContain("needs year");
    expect((await w.call("request_document", { type: "Obligatii de plata", year: 2025 })).error.message).toContain("drop year");
    expect((await w.call("request_document", { type: "Bilant anual", year: 2025 })).error.message).toContain("does not offer");
    expect((await w.call("request_document", { type: "Obligatii de plata", cif: "12345678" })).error.message).toContain("may request documents for");
    expect(w.spv.state.requests).toHaveLength(0);

    await w.call("request_document", { type: "Duplicat declaratie unica", year: 2025 });
    expect(w.spv.state.requests[0]).toMatchObject({ "form1:AnRaportare": "2025" });
    expect(w.spv.state.requests[0]).not.toHaveProperty("form1:LunaRaportare");
    await w.call("request_document", { type: "Interogari Banci", year: 2024, month: 3 });
    expect(w.spv.state.requests[1]).toMatchObject({ "form1:AnRaportare": "2024", "form1:LunaRaportare": "3" });
    await w.close();
  });

  // The form offers a person types SPV makes only for a company.
  it("holds back for a CNP the types SPV makes only for a CUI, known or learned from its refusal, and remembers them", async () => {
    const w = await world({ spv: { type: "Situatie Sintetica", message: "Raportul Situatie Sintetica se genereaza doar pentru un CUI" } });
    const before = await w.call("list_document_types");
    expect(before.types.map((t: { type: string }) => t.type)).not.toContain("Notificare");
    expect(before.types.map((t: { type: string }) => t.type)).toContain("Situatie Sintetica");
    expect(before.cui_only).toEqual([{ type: "Notificare", source: "known" }]);
    expect((await w.call("request_document", { type: "Notificare", year: 2026, month: 5 })).error).toMatchObject({ kind: "input", message: expect.stringContaining("only for a company's CUI") });
    expect(w.spv.state.requests).toHaveLength(0);

    const refused = await w.call("request_document", { type: "situatie sintetica" });
    expect(refused.error).toMatchObject({ kind: "refused", message: expect.stringContaining("remembered") });
    expect(w.spv.state.refusals).toBe(1);
    const after = await w.call("list_document_types");
    expect(after.types.map((t: { type: string }) => t.type)).not.toContain("Situatie Sintetica");
    expect(after.cui_only).toContainEqual({
      type: "Situatie Sintetica",
      source: "learned",
      learned_at: expect.any(String),
      spv_said: "Raportul Situatie Sintetica se genereaza doar pentru un CUI",
    });
    expect((await w.call("request_document", { type: "Situatie Sintetica" })).error.message).toContain("it said so on");
    expect(w.spv.state.refusals).toBe(1);
    await w.close();

    const restarted = await connected({ env: w.env, fetch: w.spv.fetch, clock: w.clock, transportFor: inMemory({ vault: () => vaultServer([]), mail: () => googleMailServer(w.box, []) }) });
    expect((await restarted.call("list_document_types")).cui_only).toHaveLength(2);
    await restarted.close();
  });

  it("passes SPV's refusal on in its own words", async () => {
    const w = await world({ spv: { type: "C168", message: "Nu exista date pentru perioada selectata." } });
    const refused = await w.call("request_document", { type: "C168" });
    expect(refused.error).toMatchObject({ kind: "refused", message: "Nu exista date pentru perioada selectata." });
    await w.close();
  });
});

// SPV archives a document about two months after posting it; its alert e-mail keeps the date.
describe("posting dates", () => {
  const D256 = `DECIZIE DE IMPUNERE DIN OFICIU a veniturilor persoanelor fizice D256 pentru CIF ${CNP}, prelucrata la 03-03-2026`;

  it("reads every line of SPV's alert e-mails: the document, its form, the day it was processed and the alert's arrival", async () => {
    const w = await world();
    w.box.deliverAlert(Date.UTC(2026, 2, 5, 8, 0, 0), [D256, D256]);
    w.box.deliverAlert(Date.UTC(2026, 3, 10, 8, 0, 0), [`Plati pentru CNP ${CNP}`]);
    w.box.deliverAlert(Date.UTC(2026, 4, 6, 8, 0, 0), [`Decizii de calcul accesorii PF pentru CIF ${CNP}, prelucrata la 05-05-2026`]);
    const all = await w.call("posting_dates");
    expect(all).toMatchObject({ ok: true, alerts: 3 });
    expect(all.lines.map((l: { alert_at: string }) => l.alert_at)).toEqual([
      "2026-05-06T11:00:00+03:00",
      "2026-04-10T11:00:00+03:00",
      "2026-03-05T10:00:00+02:00",
      "2026-03-05T10:00:00+02:00",
    ]);
    expect(all.lines[3]).toEqual({ alert_at: "2026-03-05T10:00:00+02:00", document: "DECIZIE DE IMPUNERE DIN OFICIU a veniturilor persoanelor fizice D256", form: "D256", processed_on: "2026-03-03", details: D256, mail_id: expect.any(String) });
    expect(all.lines[1]).toEqual({ alert_at: "2026-04-10T11:00:00+03:00", document: "Plati", details: `Plati pentru CNP ${CNP}`, mail_id: expect.any(String) });

    const march = await w.call("posting_dates", { since: "2026-03-05", until: "2026-03-05" });
    expect(march.lines).toHaveLength(2);
    expect(march.lines.every((l: { form: string; processed_on: string }) => l.form === "D256" && l.processed_on === "2026-03-03")).toBe(true);
    expect((await w.call("posting_dates", { text: "accesorii" })).lines).toHaveLength(1);
    expect(w.calls.some((c) => c.includes('subject:"Documente noi SPV" after:2026/03/04 before:2026/03/07'))).toBe(true);
    expect(w.spv.state.passwordPosts).toBe(0);
    await w.close();
  });

  it("says when there are more alerts than it read, and needs a mail server to read them", async () => {
    const w = await world();
    for (const day of [1, 2, 3]) w.box.deliverAlert(Date.UTC(2026, 8, day, 9), [D256]);
    expect(await w.call("posting_dates", { limit: 2 })).toMatchObject({ alerts: 2, more: expect.stringContaining("limit 2") });
    expect(await w.call("posting_dates")).toMatchObject({ alerts: 3 });
    await w.close();
    const bare = await world({ mail: "none" });
    expect((await bare.call("posting_dates")).error).toMatchObject({ kind: "config", message: expect.stringContaining("ANAF_SPV_MAIL_MCP_URL") });
    await bare.close();
  });
});

// A declaration from XML to a filing, with the filing itself refused until everything checks.
describe("declarations", () => {
  const setUp = async (duk = fakeDuk()) => {
    const inbox = mkdtempSync(join(tmpdir(), "anaf-spv-inbox-"));
    writeFileSync(join(inbox, "D212.xml"), d212());
    const w = await world({ env: { MCP_FILE_ROOTS: inbox }, duk: duk.port });
    return { w, inbox, duk };
  };
  const fileThePdf = (inbox: string, path: string) => {
    copyFileSync(path, join(inbox, "filing.pdf"));
    return "filing.pdf";
  };

  it("validates with the reporting year's kit, and saves the filing PDF only once its embedded XML is the validated file", async () => {
    const { w, duk } = await setUp();
    const ok = await w.call("validate_declaration", { xml: "D212.xml" });
    expect(ok).toMatchObject({ ok: true, valid: true, form: "D212", year: 2025, cif: CNP, namespace: "mfp:anaf:dgti:d212:declaratie:v8", errors: "ok", pdf: { embedded_xml_identical: true } });
    expect(ok.xml.sha256).toBe(createHash("sha256").update(d212()).digest("hex"));
    expect(ok.pdf.path).toMatch(new RegExp(`/D212_an-2025_${ok.xml.sha256.slice(0, 12)}\\.pdf$`));
    expect(ok.next).toContain("confirm: true");
    expect(duk.runs).toEqual([{ form: "D212", zip: "D212Validator_01082025.zip", pdf: true }]);
    expect((await w.call("validate_declaration", { xml: "D212.xml", year: 2024 })).error).toMatchObject({ kind: "input", message: expect.stringContaining("declares reporting year 2025, not year 2024") });
    expect(w.spv.state.passwordPosts).toBe(0);
    await w.close();
  });

  it("answers an invalid XML with the validator's own words, and a PDF that does not carry it as drift", async () => {
    const invalid = await setUp(fakeDuk({ valid: false, errors: "F: validari globale\n eroare structura: namespace lipsa" }));
    expect(await invalid.w.call("validate_declaration", { xml: "D212.xml" })).toMatchObject({ valid: false, errors: "F: validari globale\n eroare structura: namespace lipsa" });
    await invalid.w.close();
    const wrong = await setUp(fakeDuk({ carry: (xml) => new Uint8Array([...xml, 32]) }));
    expect((await wrong.w.call("validate_declaration", { xml: "D212.xml" })).error).toMatchObject({ kind: "drift", message: expect.stringContaining("not the validated XML") });
    writeFileSync(join(wrong.inbox, "other.xml"), "<d100 an_r='2023'/>");
    expect((await wrong.w.call("validate_declaration", { xml: "other.xml" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("not a D212") });
    await wrong.w.close();
  });

  it("files only a PDF it made, only with confirm: true, then answers the index de depunere and SPV's receipt", async () => {
    const { w, inbox } = await setUp();
    const made = await w.call("validate_declaration", { xml: "D212.xml" });
    writeFileSync(join(inbox, "stranger.pdf"), readFileSync(made.pdf.path).subarray(0, -1));
    expect((await w.call("submit_declaration", { pdf: "stranger.pdf", confirm: true })).error).toMatchObject({ kind: "input", message: expect.stringContaining("is not a PDF this server made") });
    const pdf = fileThePdf(inbox, made.pdf.path);
    const unconfirmed = await w.call("submit_declaration", { pdf });
    expect(unconfirmed.error).toMatchObject({ kind: "input", message: expect.stringContaining(`File D212 for reporting year 2025 for ${CNP} at ANAF`) });
    expect(w.spv.state.uploads).toHaveLength(0);

    const filed = await w.call("submit_declaration", { pdf, confirm: true, pdf_sha256: made.pdf.sha256 });
    expect(filed).toMatchObject({ ok: true, filed: true, index_de_depunere: "16000001", form: "D212", year: 2025, cif: CNP, declaration: { file_name: "16000001_depunere.pdf", carries_index: true } });
    expect(filed.recipisa).toMatchObject({ file_name: "1200000001.pdf", message: { type: "RECIPISA" } });
    expect(w.spv.state.uploads).toHaveLength(1);
    expect(w.spv.state.uploads[0]?.fields).toMatchObject({ form2_SUBMIT: "1", "form2:j_id217840501_cfbfbf7": "Transmitere formular" });
    expect(w.spv.state.uploads[0]?.file.bytes).toEqual(new Uint8Array(readFileSync(made.pdf.path)));

    expect((await w.call("submit_declaration", { pdf, confirm: true })).error).toMatchObject({ kind: "input", message: expect.stringContaining("index de depunere 16000001") });
    expect(w.spv.state.uploads).toHaveLength(1);
    expect((await w.call("submit_declaration", { pdf, confirm: true, refile: true })).index_de_depunere).toBe("16000002");
    await w.close();
  });

  it("passes formularespv-pf's refusal on, and lets the same PDF be sent again", async () => {
    const { w, inbox } = await setUp();
    const made = await w.call("validate_declaration", { xml: "D212.xml" });
    const pdf = fileThePdf(inbox, made.pdf.path);
    w.spv.state.uploadRefusal = "Declaraţia dumneavoastră nu a putut fi preluată.";
    expect((await w.call("submit_declaration", { pdf, confirm: true })).error).toMatchObject({ kind: "refused", message: expect.stringContaining("nu a putut fi preluată") });
    expect((await w.call("submit_declaration", { pdf, confirm: true })).index_de_depunere).toBe("16000002");
    await w.close();
  });
});

// Feature plan S2: the forms ANAF takes only through e-guvernare, signed with a qualified certificate: validated and made
// into the filing PDF here; submit_declaration checks that PDF and stops before anything is sent, with the line it would file.
describe("forms filed through e-guvernare", () => {
  const FORMS_HERE = [
    {
      form: "D100",
      file: "d100.xml",
      period: "09.2026",
      cif: "99999909",
      payable: { total_lei: "1850", items: [{ code: "121", lei: "1250" }, { code: "150", lei: "600" }] },
      line: (pdf: string) => `File D100 for 09.2026 for 99999909 (EXEMPLU TEST SRL) at ANAF, to pay 1850 lei (121: 1250, 150: 600) (${pdf}); a filed declaration cannot be withdrawn, only corrected by a D710`,
    },
    {
      form: "D300",
      file: "d300.xml",
      period: "09.2026",
      cif: "99999909",
      payable: { total_lei: "2100", refund_asked: false },
      line: (pdf: string) => `File D300 for 09.2026 for 99999909 (EXEMPLU TEST SRL) at ANAF, VAT to pay 2100 lei (${pdf}); a filed declaration cannot be withdrawn`,
    },
    {
      form: "D112",
      file: "d112.xml",
      period: "09.2026",
      cif: "99999909",
      payable: { total_lei: "500", items: [{ code: "611", lei: "500" }] },
      line: (pdf: string) => `File D112 for 09.2026 for 99999909 (EXEMPLU TEST SRL) at ANAF, to pay 500 lei (611: 500) (${pdf}); a filed declaration cannot be withdrawn, only rectified`,
    },
  ];

  for (const f of FORMS_HERE) {
    it(`${f.form}: validates with its period's package, makes the PDF, and files nothing, confirming the line the PDF's own XML gives`, async () => {
      const inbox = mkdtempSync(join(tmpdir(), "anaf-spv-inbox-"));
      const xml = readFileSync(new URL(`./fixtures/declarations/${f.file}`, import.meta.url));
      writeFileSync(join(inbox, f.file), xml);
      const duk = fakeDuk();
      const w = await world({ env: { MCP_FILE_ROOTS: inbox }, duk: duk.port });
      const made = await w.call("validate_declaration", { form: f.form, xml: f.file });
      expect(made).toMatchObject({ ok: true, valid: true, form: f.form, period: f.period, cif: f.cif, payable: f.payable, filed_through: "e-guvernare", pdf: { embedded_xml_identical: true } });
      expect(made.next).toContain("e-guvernare.ro");
      expect(made.pdf.path).toMatch(new RegExp(`/${f.form}_${f.period.slice(3)}-${f.period.slice(0, 2)}_${made.xml.sha256.slice(0, 12)}\\.pdf$`));
      expect(duk.runs).toEqual([{ form: f.form, zip: made.kit.package.zip, pdf: true }]);

      copyFileSync(made.pdf.path, join(inbox, "filing.pdf"));
      const bytes = readFileSync(join(inbox, "filing.pdf"));
      const expected = f.line(`filing.pdf, ${bytes.length} bytes, sha256 ${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`);
      // What would be filed is the PDF, and the XML it carries is the validated file byte for byte.
      expect(embeddedFiles(new Uint8Array(bytes)).map((x) => Buffer.from(x).equals(xml))).toEqual([true]);
      const refused = await w.call("submit_declaration", { pdf: "filing.pdf", confirm: true });
      expect(refused.error).toMatchObject({ kind: "unsupported", message: expect.stringContaining(`what it files: ${expected}`) });
      // The policy's line, which a person confirms, is the same line, read from the same PDF.
      const rule = policyFor(w.deps)["submit_declaration"];
      if (rule === undefined || !needsPerson(rule)) throw new Error("submit_declaration is not confirmed by a person");
      const resolved = rule.resolve === undefined ? {} : await rule.resolve({ pdf: "filing.pdf", confirm: true });
      expect(rule.summary(resolved)).toBe(expected);
      expect(w.spv.state.uploads).toHaveLength(0);
      expect(w.spv.state.passwordPosts).toBe(0);
      await w.close();
    });
  }
});

// Feature plan S1: a filing's state and receipt by its number, at any time after filing, from ANAF's public status service.
describe("a filing's status", () => {
  const RECEIPT = pdf("recipisa 1300000002");
  const filings = (): FakeFiling[] => [
    { index: "1300000002", cif: COMPANY, form: "D100", state: "Documentul este valid", registeredOn: "24.09.2026", receipt: RECEIPT },
    { index: "1290000009", cif: COMPANY, form: "D112", state: "Documentul are erori de validare.", registeredOn: "23.07.2026" },
  ];

  it("answers the state in ANAF's words and saves the receipt, without signing in anywhere", async () => {
    const w = await world({ filings: filings() });
    const ok = await w.call("declaration_status", { reference: "INTERNT-1300000002-2026", cif: `RO ${COMPANY}` });
    expect(ok).toMatchObject({
      ok: true,
      found: true,
      index: "1300000002",
      cif: COMPANY,
      status: "valid",
      state: "Documentul este valid",
      form: "D100",
      registration_number: "INTERNT-1300000002-2026",
      registered_on: "2026-09-24",
      uploaded_on: "2026-09-24",
      receipt: { saved: true, bytes: RECEIPT.length, sha256: createHash("sha256").update(RECEIPT).digest("hex") },
      window: { from: "2026-07-22", to: "2026-10-22", filings_listed: 2 },
    });
    expect(ok.receipt.path).toMatch(/\/2026-09-24_recipisa-stare_1300000002\.pdf$/);
    expect(readFileSync(ok.receipt.path)).toEqual(Buffer.from(RECEIPT));
    expect(w.stare.state.lookups).toEqual([{ id: "1300000002", cui: COMPANY, ghiseu: "N" }]);

    const old = await w.call("declaration_status", { reference: "1290000009", cif: COMPANY });
    expect(old).toMatchObject({ found: true, status: "validation_errors", meaning: expect.stringContaining("receipt lists"), receipt: { saved: false, why: expect.stringContaining("60 days") } });
    expect(w.stare.state.receipts).toEqual(["1300000002"]);
    expect(w.spv.state.passwordPosts).toBe(0);
    await w.close();
  });

  it("says where to look once the service no longer lists a filing, and needs the tax id of one it did not file", async () => {
    const w = await world({ filings: filings() });
    const gone = await w.call("declaration_status", { reference: "INTERNT-1999999901-2025", cif: COMPANY, receipt: false });
    expect(gone).toMatchObject({ ok: true, found: false, index: "1999999901", next: expect.stringContaining('"Duplicat Recipisa" with registration_number INTERNT-1999999901-2025') });
    expect((await w.call("declaration_status", { reference: "1300000002" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("cif is required") });
    expect((await w.call("declaration_status", { reference: "D100 of September", cif: COMPANY })).error).toMatchObject({ kind: "input" });
    expect((await w.call("declaration_status", { reference: "1300000002", cif: "RO0123" })).error).toMatchObject({ kind: "input", message: expect.stringContaining("not a CNP") });
    expect(w.stare.state.lookups).toHaveLength(1);
    await w.close();
  });

  it("finds a filing it made by the index de depunere, through the index de încărcare SPV's receipt gave", async () => {
    const inbox = mkdtempSync(join(tmpdir(), "anaf-spv-inbox-"));
    writeFileSync(join(inbox, "D212.xml"), d212());
    const w = await world({
      env: { MCP_FILE_ROOTS: inbox },
      duk: fakeDuk().port,
      filings: [{ index: "1200000001", cif: CNP, form: "D212", state: "Documentul este valid", registeredOn: "12.10.2026", receipt: pdf("recipisa 1200000001") }],
    });
    const made = await w.call("validate_declaration", { xml: "D212.xml" });
    copyFileSync(made.pdf.path, join(inbox, "filing.pdf"));
    const filed = await w.call("submit_declaration", { pdf: "filing.pdf", confirm: true });
    expect(filed).toMatchObject({ index_de_depunere: "16000001", index_de_incarcare: "1200000001", registration_number: "INTERNT-1200000001-2026", next: expect.stringContaining("declaration_status with 1200000001") });

    const status = await w.call("declaration_status", { reference: "16000001" });
    expect(status).toMatchObject({
      found: true,
      index: "1200000001",
      cif: CNP,
      status: "valid",
      form: "D212",
      filed_here: { form: "D212", index_de_depunere: "16000001", index_de_incarcare: "1200000001", registration_number: "INTERNT-1200000001-2026", outcome: "accepted" },
    });
    expect(w.stare.state.lookups).toEqual([{ id: "1200000001", cui: CNP, ghiseu: "N" }]);
    expect((await w.call("declaration_status", { reference: "1200000001", receipt: false })).filed_here).toMatchObject({ index_de_depunere: "16000001" });
    await w.close();
  });
});

describe("the contact form", () => {
  const inbox = () => mkdtempSync(join(tmpdir(), "anaf-spv-inbox-"));
  const TEXT = "Buna ziua, as dori informatii despre programul de lucru cu publicul.\nMultumesc.";

  it("by default reads the form and answers the message as it would go, sending nothing", async () => {
    const w = await world({ env: { MCP_FILE_ROOTS: inbox() } });
    const dry = await w.call("submit_contact_form", { cif: CNP, text: "Bună ziua, aș dori „informații” – programul de lucru…\nMulţumesc." });
    expect(dry).toMatchObject({
      ok: true,
      dry_run: true,
      sent: false,
      form: { preselected: COMPANY, identities: [{ cif: COMPANY }, { cif: CNP, label: `${CNP} -- POPESCU ANA` }] },
      message: { cif: CNP, identity: `${CNP} -- POPESCU ANA`, category: { value: "3", label: "Asistență și îndrumare de specialitate în domeniul fiscal" } },
    });
    expect(dry.message.text).toBe('Buna ziua, as dori "informatii" - programul de lucru...\nMultumesc.');
    expect(dry.next).toContain(`preselects ${COMPANY}`);
    expect(w.spv.state.contacts).toEqual([]);
    await w.close();
  });

  it("checks the identity, the category, the subcategory and the text against the live form before anything is sent", async () => {
    const w = await world({ env: { MCP_FILE_ROOTS: inbox() } });
    const errorFor = async (args: Record<string, unknown>) => (await w.call("submit_contact_form", { cif: CNP, text: TEXT, dry_run: false, ...args })).error;
    expect(await errorFor({ cif: "2990101999998" })).toMatchObject({ kind: "input", message: expect.stringContaining(`${COMPANY}, ${CNP}`) });
    expect(await errorFor({ category: 4 })).toMatchObject({ kind: "input" });
    expect(await errorFor({ subcategory: 30 })).toMatchObject({ kind: "input", message: "category 3 takes no subcategory; drop it" });
    expect((await errorFor({ category: 1 })).message).toContain("30 (Cereri)");
    expect((await errorFor({ category: 1, subcategory: 51 })).message).toContain("not 51");
    expect((await errorFor({ text: "x".repeat(1501) })).message).toContain("at most 1500");
    expect((await errorFor({ text: "Mulțumesc 🙂" })).message).toContain("🙂");
    expect(w.spv.state.contacts).toEqual([]);
    await w.close();
  });

  it("takes an attachment by path from the inbox only, byte for byte, with a plain name", async () => {
    const dir = inbox();
    const bytes = pdf("cerere");
    writeFileSync(join(dir, "Cerere ștampilă.pdf"), bytes);
    writeFileSync(join(dir, "cerere.docx"), bytes);
    const w = await world({ env: { MCP_FILE_ROOTS: dir } });
    const sha = createHash("sha256").update(bytes).digest("hex");
    const dry = await w.call("submit_contact_form", { cif: CNP, text: TEXT, attachment: "Cerere ștampilă.pdf", attachment_sha256: sha });
    expect(dry.message.attachment).toEqual({ name: "Cerere_stampila.pdf", bytes: bytes.byteLength, sha256: sha });
    expect((await w.call("submit_contact_form", { cif: CNP, text: TEXT, attachment: "cerere.docx" })).error).toMatchObject({ kind: "input" });
    expect((await w.call("submit_contact_form", { cif: CNP, text: TEXT, attachment: "Cerere ștampilă.pdf", attachment_sha256: "0".repeat(64) })).error).toMatchObject({ kind: "checksum_mismatch" });
    expect((await w.call("submit_contact_form", { cif: CNP, text: TEXT, attachment: "/etc/hostname" })).error).toMatchObject({ kind: "input" });
    const schema = (await w.client.listTools()).tools.find((t) => t.name === "submit_contact_form")?.inputSchema.properties ?? {};
    expect(Object.keys(schema)).not.toContain("content_base64");

    const sent = await w.call("submit_contact_form", { cif: CNP, text: TEXT, attachment: "Cerere ștampilă.pdf", dry_run: false });
    expect(sent.ok).toBe(true);
    expect(w.spv.state.contacts[0]?.file).toEqual({ name: "Cerere_stampila.pdf", type: "application/pdf", bytes });
    await w.close();
  });

  it("sends once with dry_run: false and answers the registration number, the date and the text SPV shows", async () => {
    const w = await world({ env: { MCP_FILE_ROOTS: inbox() } });
    const sent = await w.call("submit_contact_form", { cif: CNP, text: TEXT, dry_run: false });
    expect(sent).toMatchObject({
      ok: true,
      sent: true,
      registration_number: "50000000001",
      registered_on: "2026-10-12",
      shown: { cif: CNP },
      shown_matches: { cif: true, text: true },
      message: { cif: CNP, category: { value: "3" } },
    });
    expect(sent.next).toContain("50000000001");
    expect(w.spv.state.contacts).toHaveLength(1);
    expect(w.spv.state.contacts[0]?.fields).toEqual({
      "org.apache.struts.taglib.html.TOKEN": "tok-1",
      cif_ales: CNP,
      categSolicit: "3",
      subcategSolicit: "0",
      textintrebare: TEXT.replaceAll("\n", "\r\n"),
      submit: "submit",
    });
    expect(w.spv.state.contacts[0]?.file).toBeUndefined();

    const again = await w.call("submit_contact_form", { cif: CNP, text: TEXT, dry_run: false });
    expect(again.error).toMatchObject({ kind: "input", message: expect.stringContaining("registered on 2026-10-12 as 50000000001") });
    expect((await w.call("submit_contact_form", { cif: CNP, text: TEXT })).sent_before).toMatchObject({ outcome: "registered", registration_number: "50000000001" });
    expect(w.spv.state.contacts).toHaveLength(1);
    expect((await w.call("submit_contact_form", { cif: CNP, text: TEXT, dry_run: false, again: true })).registration_number).toBe("50000000002");
    await w.close();
  });

  it("calls a form that comes back without a registration number refused, and lets the same message be sent again", async () => {
    const w = await world({ env: { MCP_FILE_ROOTS: inbox() } });
    w.spv.state.contactSilently = true;
    const failed = await w.call("submit_contact_form", { cif: CNP, text: TEXT, dry_run: false });
    expect(failed.error).toMatchObject({ kind: "refused", message: expect.stringContaining("did not register") });
    w.spv.state.contactSilently = false;
    expect((await w.call("submit_contact_form", { cif: CNP, text: TEXT, dry_run: false })).registration_number).toBe("50000000002");
    await w.close();
  });
});

describe("configuration", () => {
  it("starts and answers health with nothing configured, and says what is missing without touching SPV", async () => {
    const clock = makeClock();
    let fetched = 0;
    const fetch = (async () => {
      fetched += 1;
      return new Response("no");
    }) as typeof globalThis.fetch;
    const s = await connected({ env: { ANAF_SPV_STATE_DIR: stateDir() }, fetch, clock });
    const health = await s.call("health");
    expect(health).toMatchObject({ ok: true, credential: { kind: "none" }, code: { driver: "manual" }, session: "none", automatic_login: false });
    expect(health.problems).toHaveLength(2);
    const failed = await s.call("list_messages");
    expect(failed.error).toMatchObject({ kind: "config" });
    expect(failed.error.message).toContain("ANAF_SPV_VAULT_MCP_URL");
    expect(fetched).toBe(0);
    await s.close();
  });

  it("takes the password from a file with the user name from a variable", async () => {
    const clock = makeClock();
    const box = makeMailbox(clock.now);
    const spv = makeFakeSpv({ mail: box.deliverCode });
    const dir = stateDir();
    const passwordFile = join(dir, "password");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(passwordFile, "correct horse battery staple\n", { mode: 0o600 });
    const s = await connected({
      env: { ANAF_SPV_STATE_DIR: dir, ANAF_SPV_USERNAME: "ana.popescu", ANAF_SPV_PASSWORD_FILE: passwordFile, ...MAIL },
      fetch: spv.fetch,
      transportFor: inMemory({ mail: () => googleMailServer(box, []) }),
      clock,
    });
    expect((await s.call("health")).credential).toEqual({ kind: "file", username: "ana.popescu" });
    expect((await s.call("list_messages")).ok).toBe(true);
    await s.close();
  });
});

describe("keepalive", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads a page every N minutes while the session lives, and stops once SPV has ended it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const w = await world({ env: { ANAF_SPV_KEEPALIVE_MIN: "1" } });
    await w.call("login");
    const loads = () => w.spv.state.pageLoads;
    const before = loads();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(loads()).toBe(before + 1));
    w.spv.expireAll();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(loads()).toBe(before + 2));
    await vi.advanceTimersByTimeAsync(180_000);
    expect(loads()).toBe(before + 2);
    expect(w.spv.state.passwordPosts).toBe(1);
    await w.close();
  });
});
