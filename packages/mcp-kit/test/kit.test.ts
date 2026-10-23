import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { backoffMs, retryAfterSeconds } from "../src/backoff.js";
import { addDays, daysBetween, isIsoDate, weekdayOf } from "../src/dates.js";
import { makeHandled } from "../src/envelope.js";
import { makeErrorKit } from "../src/errors.js";
import { writeFileAtomic } from "../src/files.js";
import { readJsonFile, withFileLock, writeJsonFile } from "../src/jsonFile.js";
import { once } from "../src/once.js";

type Failure = { readonly kind: "input"; readonly message: string };

describe("error kit", () => {
  const kit = makeErrorKit<Failure>("test");

  it("round-trips a failure through a throw", () => {
    try {
      kit.fail({ kind: "input", message: "no" });
      expect.unreachable();
    } catch (thrown) {
      expect(kit.asAppError(thrown)).toEqual({ kind: "input", message: "no" });
    }
  });

  it("does not claim someone else's throw", () => {
    expect(kit.asAppError(new Error("boom"))).toBeUndefined();
    expect(kit.asAppError("boom")).toBeUndefined();
    expect(kit.asAppError(null)).toBeUndefined();
  });

  it("keeps two servers' failures apart", () => {
    // Two servers in one process must not catch each other's failures and
    // report them under their own remedies.
    const other = makeErrorKit<Failure>("other");
    try {
      kit.fail({ kind: "input", message: "mine" });
    } catch (thrown) {
      expect(other.asAppError(thrown)).toBeUndefined();
    }
  });
});

describe("envelope", () => {
  const kit = makeErrorKit<Failure>("test");
  const handled = makeHandled<Failure>({ asAppError: kit.asAppError, remedyFor: () => "fix it" });
  const body = (r: { content: [{ text: string }, ...unknown[]] }) => JSON.parse(r.content[0].text) as Record<string, any>;

  it("passes a result through as JSON", async () => {
    expect(body(await handled(async () => ({ rows: [] }))())).toEqual({ rows: [] });
  });

  it("turns a known failure into an error KEY, with its remedy", async () => {
    const out = body(await handled(async () => kit.fail({ kind: "input", message: "no" }))());
    expect(out["error"]).toEqual({ kind: "input", message: "no", remedy: "fix it" });
  });

  it("never lets an unexpected throw escape as a protocol error", async () => {
    const out = body(
      await handled(async () => {
        throw new TypeError("undefined is not a function");
      })(),
    );
    expect(out["error"]).toMatchObject({ kind: "unexpected" });
  });
});

describe("once", () => {
  it("loads once and shares the result", async () => {
    let loads = 0;
    const load = once(async () => ++loads);
    await Promise.all([load(), load(), load()]);
    expect(loads).toBe(1);
  });

  it("does not cache a rejection, so a repaired config works on the next call", async () => {
    let attempt = 0;
    const load = once(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("missing");
      return "ok";
    });
    await expect(load()).rejects.toThrow("missing");
    await expect(load()).resolves.toBe("ok");
  });
});

describe("backoff", () => {
  const noJitter = { random: () => 0 };

  it("doubles, then stops doubling", () => {
    expect(backoffMs(0, undefined, noJitter)).toBe(1000);
    expect(backoffMs(3, undefined, noJitter)).toBe(8000);
    expect(backoffMs(20, undefined, noJitter)).toBe(32_000);
  });

  it("prefers what the server asked for", () => {
    expect(backoffMs(0, 7, noJitter)).toBe(7000);
  });

  it("jitters, because one rate limit releases every session at the same instant", () => {
    expect(backoffMs(0, undefined, { random: () => 0.5, jitterMs: 1000 })).toBe(1500);
  });

  it("reads a Retry-After header, and refuses anything that is not seconds", () => {
    expect(retryAfterSeconds("30")).toBe(30);
    expect(retryAfterSeconds("0")).toBe(0);
    expect(retryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
    expect(retryAfterSeconds("-1")).toBeUndefined();
    expect(retryAfterSeconds(null)).toBeUndefined();
  });
});

describe("dates", () => {
  it("accepts only real calendar dates", () => {
    expect(isIsoDate("2026-01-15")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("15-01-2026")).toBe(false);
  });

  it("adds days across a month and a leap year", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("counts whole days between two dates", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysBetween("2026-01-31", "2026-01-01")).toBe(-30);
  });

  it("names the weekday of a date, Sunday as 0", () => {
    expect(weekdayOf("2026-03-29")).toBe(0);
    expect(weekdayOf("2026-10-26")).toBe(1);
    expect(weekdayOf("2024-02-29")).toBe(4);
  });
});

describe("withFileLock", () => {
  it("creates the lock sidecar 0600, like the file it guards", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-"));
    await withFileLock(dir, "tokens.lock", async () => undefined);
    expect((await stat(join(dir, "tokens.lock"))).mode & 0o777).toBe(0o600);
  });
});

describe("writeFileAtomic", () => {
  it("writes the whole file under its mode, leaves no temp file, and survives concurrent writes of one name", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "kit-files-")), "out", "2026-09");
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const path = await writeFileAtomic(dir, "a.zip", bytes, { mode: 0o640 });
    expect(path).toBe(join(dir, "a.zip"));
    expect(new Uint8Array(await readFile(path))).toEqual(bytes);
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    await Promise.all(["one", "two", "three"].map((text) => writeFileAtomic(dir, "same.txt", text)));
    expect(["one", "two", "three"]).toContain(await readFile(join(dir, "same.txt"), "utf8"));
    expect((await readdir(dir)).toSorted()).toEqual(["a.zip", "same.txt"]);
  });
});

describe("json files", () => {
  const dir = async () => mkdtemp(join(tmpdir(), "mcp-kit-"));

  it("writes 0600, because these files hold credentials", async () => {
    const path = join(await dir(), "tokens.json");
    await writeJsonFile(path, { token: "secret" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("leaves no window where the file is world-readable", async () => {
    // The mode goes on the temp file: rename preserves it, a chmod afterwards
    // would not.
    const path = join(await dir(), "nested", "deep", "tokens.json");
    await writeJsonFile(path, { token: "secret" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("round-trips, pretty by default and compact on request", async () => {
    const base = await dir();
    await writeJsonFile(join(base, "a.json"), { a: 1 });
    await writeJsonFile(join(base, "b.json"), { a: 1 }, { pretty: false });
    expect(await readFile(join(base, "a.json"), "utf8")).toBe('{\n  "a": 1\n}\n');
    expect(await readFile(join(base, "b.json"), "utf8")).toBe('{"a":1}');
    await expect(readJsonFile(join(base, "a.json"))).resolves.toEqual({ a: 1 });
  });

  it("reads an absent or corrupt file as undefined, not as a crash", async () => {
    const base = await dir();
    await expect(readJsonFile(join(base, "nope.json"))).resolves.toBeUndefined();
    await writeJsonFile(join(base, "bad.json"), undefined);
    await expect(readJsonFile(join(base, "bad.json"))).resolves.toBeUndefined();
  });

  it("serialises a read-modify-write, so a concurrent one cannot be lost", async () => {
    const base = await dir();
    const path = join(base, "book.json");
    await writeJsonFile(path, {});
    const put = (key: string) =>
      withFileLock(base, "book.lock", async () => {
        const book = (await readJsonFile<Record<string, number>>(path)) ?? {};
        await writeJsonFile(path, { ...book, [key]: 1 });
      });
    await Promise.all([put("a"), put("b"), put("c")]);
    expect(await readJsonFile(path)).toEqual({ a: 1, b: 1, c: 1 });
  });
});
