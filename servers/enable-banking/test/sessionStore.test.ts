/**
 * sessions.json on disk: what a save writes, what it keeps aside, and what it
 * leaves alone. A temp state dir per test.
 */
import { readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { makeSessionStore } from "../src/infra/sessionStore.js";
import { SESSION_ID, sessionResponse } from "./fixtures.js";
import { pathsOf, testEnv } from "./support.js";

const setUp = () => {
  const paths = pathsOf(testEnv());
  return { paths, store: makeSessionStore(paths, () => 1_790_000_000_000) };
};

const onDisk = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** A reduced entry another program wrote: kept by every save, byte for byte in meaning. */
const REDUCED_ENTRY = {
  access: { balances: true, transactions: true, valid_until: "2030-06-30T00:00:00Z" },
  accounts: [{ identification: "DE00SYNT00000000000009", uid: "u-old" }],
  aspsp: { country: "DE", name: "Example Bank" },
  psu_type: "business",
  session_id: "s-reduced",
};

describe("save", () => {
  it("writes the entry as sent, at 0600, into a state dir it creates", async () => {
    const { paths, store } = setUp();
    const saved = await store.save("example_business", sessionResponse());
    expect(onDisk(paths.sessions)).toEqual({ example_business: sessionResponse() });
    expect(statSync(paths.sessions).mode & 0o777).toBe(0o600);
    expect(saved).toEqual({ backup: undefined, replaced: undefined });
  });

  it("copies the previous file to sessions.json.bak first, and reports what it replaced", async () => {
    const { paths, store } = setUp();
    await store.save("example_business", sessionResponse({ session_id: "s-old" }));
    const saved = await store.save("example_business", sessionResponse());
    expect(saved.backup).toBe(paths.backup);
    expect(saved.replaced).toMatchObject({ label: "example_business", sessionId: "s-old" });
    expect(onDisk(paths.backup)).toEqual({ example_business: sessionResponse({ session_id: "s-old" }) });
    expect(statSync(paths.backup).mode & 0o777).toBe(0o600);
    expect(onDisk(paths.sessions)).toEqual({ example_business: sessionResponse() });
  });

  it("carries every other label over exactly as it was, whatever wrote it", async () => {
    const { paths, store } = setUp();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.sessions, JSON.stringify({ legacy: REDUCED_ENTRY, odd: { note: "kept" } }, null, 2));
    await store.save("example_business", sessionResponse());
    expect(onDisk(paths.sessions)).toEqual({ legacy: REDUCED_ENTRY, odd: { note: "kept" }, example_business: sessionResponse() });
  });

  it("keeps an unreadable file's text aside under its own name before the first write", async () => {
    // The .bak of the NEXT consent would overwrite a plain backup; this copy is not.
    const { paths, store } = setUp();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.sessions, "{ half a file");
    const saved = await store.save("example_business", sessionResponse());
    expect(saved.backup).toBe(`${paths.sessions}.unreadable-1790000000000`);
    expect(onDisk(saved.backup as string)).toBe("{ half a file");
    expect(onDisk(paths.sessions)).toEqual({ example_business: sessionResponse() });
  });

  it("loses neither of two consents stored at once", async () => {
    // Every writer takes the lock; a plain overwrite would drop one of the two.
    const { paths, store } = setUp();
    await Promise.all([store.save("one", sessionResponse({ session_id: "s1" })), store.save("two", sessionResponse({ session_id: "s2" }))]);
    expect(Object.keys(onDisk(paths.sessions) as object).sort()).toEqual(["one", "two"]);
  });
});

describe("read", () => {
  it("reads nothing from a state dir that does not exist yet", async () => {
    expect(await setUp().store.read()).toEqual({ sessions: [], unreadable: [] });
  });

  it("reads the current format and a reduced entry side by side", async () => {
    const { paths, store } = setUp();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.sessions, JSON.stringify({ example_business: sessionResponse(), legacy: REDUCED_ENTRY, broken: {} }));
    const book = await store.read();
    expect(book.sessions.map((s) => [s.label, s.sessionId])).toEqual([
      ["example_business", SESSION_ID],
      ["legacy", "s-reduced"],
    ]);
    expect(book.sessions[1]?.accounts).toEqual([{ uid: "u-old", iban: "DE00SYNT00000000000009", currency: undefined, name: undefined }]);
    expect(book.unreadable).toEqual(["broken"]);
  });

  it("reads an unreadable file as empty rather than failing every tool", async () => {
    const { paths, store } = setUp();
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.sessions, "[1, 2");
    expect(await store.read()).toEqual({ sessions: [], unreadable: [] });
  });
});
