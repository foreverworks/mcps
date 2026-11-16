import { rmSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isTempName, tempSuffix } from "../src/files.js";
import { storeStream } from "../src/fileStream.js";
import { sweepIntervalMs } from "../src/serve/files.js";
import { startSweeping, sweepFolders } from "../src/serve/filesSweep.js";

const MIN = 60_000;

let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "mcp-kit-sweep-"));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** Makes a file, last written `minutes` before `at`. */
const file = async (path: string, minutes: number, at: number, data = "bytes"): Promise<string> => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, data);
  const when = new Date(at - minutes * MIN);
  await utimes(path, when, when);
  return path;
};

/** Sets a folder's own mtime, which making or emptying it has just moved. */
const touch = async (path: string, minutes: number, at: number): Promise<void> => {
  const when = new Date(at - minutes * MIN);
  await utimes(path, when, when);
};

const names = async (dir: string): Promise<string[]> => (await readdir(dir)).sort();
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

describe("sweepIntervalMs", () => {
  it("is a quarter of the age, no oftener than a minute and no rarer than an hour", () => {
    expect(sweepIntervalMs(1)).toBe(MIN);
    expect(sweepIntervalMs(4)).toBe(MIN);
    expect(sweepIntervalMs(10)).toBe(2.5 * MIN);
    expect(sweepIntervalMs(60)).toBe(15 * MIN);
    expect(sweepIntervalMs(240)).toBe(60 * MIN);
    expect(sweepIntervalMs(100_000)).toBe(60 * MIN);
  });
});

describe("sweepFolders", () => {
  it("deletes the files older than the age and keeps the fresh ones, in every folder below", async () => {
    const now = Date.now();
    const root = join(base, "inbox");
    await file(join(root, "old.pdf"), 61, now);
    await file(join(root, "fresh.pdf"), 59, now);
    await file(join(root, "a", "old.txt"), 600, now);
    await file(join(root, "a", "fresh.txt"), 1, now);
    await file(join(root, "b", "c", "old.bin"), 90, now);

    const done = await sweepFolders([root], { maxAgeMs: 60 * MIN, now: () => now });

    expect(done).toEqual({ files: 3, folders: 2, failed: 0 });
    expect(await names(root)).toEqual(["a", "fresh.pdf"]);
    expect(await names(join(root, "a"))).toEqual(["fresh.txt"]);
  });

  it("removes the folders it leaves empty, and a folder that has sat empty for the age, but never the root", async () => {
    const now = Date.now();
    const root = join(base, "out");
    await file(join(root, "deep", "er", "old.txt"), 90, now);
    await mkdir(join(root, "left-empty"));
    await touch(join(root, "left-empty"), 90, now);
    await mkdir(join(root, "just-made"));

    const done = await sweepFolders([root], { maxAgeMs: 60 * MIN, now: () => now });

    expect(done).toMatchObject({ files: 1, folders: 3, failed: 0 });
    // A folder an upload made for itself a moment ago is not taken from under it.
    expect(await names(root)).toEqual(["just-made"]);

    await rm(join(root, "just-made"), { recursive: true });
    await sweepFolders([root], { maxAgeMs: 60 * MIN, now: () => now });
    expect(await exists(root)).toBe(true);
    expect(await names(root)).toEqual([]);
  });

  it("counts an age as older than, not as old as", async () => {
    const now = Date.now();
    const root = join(base, "inbox");
    await file(join(root, "kept.txt"), 59.9, now);
    await file(join(root, "gone.txt"), 60.1, now);
    await sweepFolders([root], { maxAgeMs: 60 * MIN, now: () => now });
    expect(await names(root)).toEqual(["kept.txt"]);
  });

  it("does not follow a link, and leaves links where they are", async () => {
    const now = Date.now();
    const root = join(base, "inbox");
    const elsewhere = join(base, "elsewhere");
    await file(join(elsewhere, "old.txt"), 600, now);
    await file(join(elsewhere, "deep", "old.txt"), 600, now);
    await file(join(root, "real", "old.txt"), 600, now);
    await symlink(elsewhere, join(root, "link-to-folder"));
    await symlink(join(elsewhere, "old.txt"), join(root, "link-to-file"));
    await symlink(join(base, "nothing"), join(root, "dangling"));
    await symlink(join(root, "real"), join(root, "link-inside"));
    await touch(elsewhere, 600, now);

    const done = await sweepFolders([root], { maxAgeMs: 60 * MIN, now: () => now });

    // The one real file goes (once); every link stays, and so does everything outside the root.
    expect(done).toEqual({ files: 1, folders: 1, failed: 0 });
    expect(await names(root)).toEqual(["dangling", "link-inside", "link-to-file", "link-to-folder"]);
    expect(await names(elsewhere)).toEqual(["deep", "old.txt"]);
    expect(await names(join(elsewhere, "deep"))).toEqual(["old.txt"]);
  });

  it("sweeps a root that is itself a link, as the endpoints serve it", async () => {
    const now = Date.now();
    const real = join(base, "real");
    await file(join(real, "old.txt"), 600, now);
    await symlink(real, join(base, "inbox"));
    const done = await sweepFolders([join(base, "inbox")], { maxAgeMs: 60 * MIN, now: () => now });
    expect(done.files).toBe(1);
    expect(await names(real)).toEqual([]);
  });

  it("does nothing to a root that does not exist yet, and does not make it", async () => {
    const root = join(base, "not-yet");
    expect(await sweepFolders([root], { maxAgeMs: MIN })).toEqual({ files: 0, folders: 0, failed: 0 });
    expect(await exists(root)).toBe(false);
  });

  it("sweeps a folder named twice, and never removes a root that lies inside another", async () => {
    const now = Date.now();
    const inbox = join(base, "shared");
    const outbox = join(inbox, "out");
    await file(join(inbox, "old-in.txt"), 90, now);
    await file(join(outbox, "old-out.txt"), 90, now);
    await touch(outbox, 90, now);

    const done = await sweepFolders([inbox, outbox, inbox], { maxAgeMs: 60 * MIN, now: () => now });

    expect(done).toEqual({ files: 2, folders: 0, failed: 0 });
    expect(await names(inbox)).toEqual(["out"]);
    expect(await names(outbox)).toEqual([]);
  });

  it("holds the temp file of a write in progress to a longer limit than a finished file", async () => {
    const now = Date.now();
    const root = join(base, "inbox");
    const tempName = `scan.pdf${tempSuffix()}`;
    expect(isTempName(tempName)).toBe(true);
    expect(isTempName("scan.pdf")).toBe(false);
    expect(isTempName("report.2026.tmp")).toBe(false);
    await file(join(root, tempName), 1.5, now);
    await file(join(root, "scan.pdf"), 1.5, now);

    await sweepFolders([root], { maxAgeMs: MIN, now: () => now });
    expect(await names(root)).toEqual([tempName]);

    // Only a temp file nobody has written to for minutes, which a crashed server leaves, goes.
    await touch(join(root, tempName), 5, now);
    await sweepFolders([root], { maxAgeMs: MIN, now: () => now });
    expect(await names(root)).toEqual([]);
  });

  it("leaves alone a file an upload is still writing, whatever the age, and takes it once it is finished and old", async () => {
    const root = join(base, "inbox");
    await mkdir(root);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    async function* slow(): AsyncGenerator<Uint8Array> {
      yield Buffer.from("first half, ");
      await gate;
      yield Buffer.from("second half");
    }
    const storing = storeStream(slow(), join(root, "scan.pdf"), { maxBytes: 1024 });
    // The temp file is there as soon as the upload has begun.
    await vi.waitFor(async () => expect((await readdir(root)).filter(isTempName)).toHaveLength(1));

    // 90 seconds on, a finished file written now would be past a one-minute age; the temp file of a write under way is not.
    const during = await sweepFolders([root], { maxAgeMs: MIN, now: () => Date.now() + 90_000 });
    expect(during).toEqual({ files: 0, folders: 0, failed: 0 });
    expect((await readdir(root)).filter(isTempName)).toHaveLength(1);

    release();
    expect(await storing).toMatchObject({ ok: true, size: 23 });
    expect(await names(root)).toEqual(["scan.pdf"]);
    expect((await sweepFolders([root], { maxAgeMs: MIN, now: () => Date.now() + 90_000 })).files).toBe(1);
    expect(await names(root)).toEqual([]);
  });

  it("takes a file that vanishes during the sweep for the gone file it is, not a failure", async () => {
    const now = Date.now();
    const root = join(base, "inbox");
    await Promise.all(["a", "b", "c", "d"].map((name) => file(join(root, `${name}.txt`), 90, now)));
    let removed = false;
    const done = await sweepFolders([root], {
      maxAgeMs: 60 * MIN,
      now: () => {
        // The first decision comes after the folder has been listed: everything in it is removed by someone else.
        if (!removed) {
          removed = true;
          for (const name of ["a", "b", "c", "d"]) rmSync(join(root, `${name}.txt`));
        }
        return now;
      },
    });
    expect(removed).toBe(true);
    expect(done).toEqual({ files: 0, folders: 0, failed: 0 });
    expect(await names(root)).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)("counts an error it cannot get past, carries on with the rest, and does not throw", async () => {
    const now = Date.now();
    const root = join(base, "inbox");
    await file(join(root, "sealed", "old.txt"), 90, now);
    await file(join(root, "open", "old.txt"), 90, now);
    await chmod(join(root, "sealed"), 0o555);
    try {
      const done = await sweepFolders([root], { maxAgeMs: 60 * MIN, now: () => now });
      expect(done).toEqual({ files: 1, folders: 1, failed: 1, code: "EACCES" });
      expect(await exists(join(root, "sealed", "old.txt"))).toBe(true);
      expect(await names(root)).toEqual(["sealed"]);
    } finally {
      await chmod(join(root, "sealed"), 0o755);
    }
  });

  it("reports a root it cannot read as a failure, with the system's code, and does not throw", async () => {
    const root = join(base, "a-file");
    await writeFile(root, "not a folder");
    const done = await sweepFolders([root], { maxAgeMs: MIN });
    expect(done).toEqual({ files: 0, folders: 0, failed: 1, code: "ENOTDIR" });
    expect(await exists(root)).toBe(true);
  });
});

describe("startSweeping", () => {
  afterEach(() => vi.useRealTimers());

  it("starts nothing without an age: no timer, no sweep, no line", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const root = join(base, "inbox");
    await file(join(root, "old.txt"), 1e6, now);
    const log: string[] = [];
    expect(startSweeping({ inbox: root, maxBytes: 1024 }, { service: "svc", log: (line) => log.push(line) })).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(24 * 60 * MIN);
    expect(await names(root)).toEqual(["old.txt"]);
    expect(log).toEqual([]);
  });

  it("sweeps once at the start and then on the interval, on a timer that does not keep the process alive", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setInterval");
    const inbox = join(base, "inbox");
    const outbox = join(base, "outbox");
    const start = Date.now();
    await file(join(inbox, "old.txt"), 20, start);
    await file(join(outbox, "sub", "old.txt"), 20, start);
    await file(join(inbox, "fresh.txt"), 1, start);
    const log: string[] = [];

    const sweeper = startSweeping({ inbox, outbox, maxBytes: 1024, maxAgeMin: 8 }, { service: "svc", log: (line) => log.push(line) });
    expect(sweeper).toBeDefined();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe(2 * MIN);
    expect((spy.mock.results[0]?.value as NodeJS.Timeout).hasRef()).toBe(false);

    await sweeper?.idle();
    expect(await names(inbox)).toEqual(["fresh.txt"]);
    expect(await names(outbox)).toEqual([]);
    expect(log).toEqual([`files ${JSON.stringify({ svc: "svc", direction: "sweep", outcome: "ok", removed: 2, folders: 1 })}`]);

    // The fresh file was a minute old at the start: 7 minutes old at the third tick, 9 at the fourth, which is past the age.
    for (let tick = 1; tick <= 4; tick += 1) {
      await vi.advanceTimersByTimeAsync(2 * MIN);
      await sweeper?.idle();
      expect(await exists(join(inbox, "fresh.txt"))).toBe(tick < 4);
    }
    expect(log).toHaveLength(2);

    await sweeper?.stop();
    expect(vi.getTimerCount()).toBe(0);
    await file(join(inbox, "late.txt"), 1e6, Date.now());
    await vi.advanceTimersByTimeAsync(24 * 60 * MIN);
    expect(await exists(join(inbox, "late.txt"))).toBe(true);
  });

  it("writes one line for a sweep that fails, with the code and no path, and sweeps again at the next tick", async () => {
    vi.useFakeTimers();
    const inbox = join(base, "a-file");
    await writeFile(inbox, "not a folder");
    const log: string[] = [];
    const sweeper = startSweeping({ inbox, maxBytes: 1024, maxAgeMin: 4 }, { service: "svc", log: (line) => log.push(line) });
    await sweeper?.idle();
    expect(log).toEqual([`files ${JSON.stringify({ svc: "svc", direction: "sweep", outcome: "failed", removed: 0, folders: 0, failed: 1, code: "ENOTDIR" })}`]);
    expect(log.join("")).not.toContain(base);

    await rm(inbox);
    await file(join(inbox, "old.txt"), 90, Date.now());
    await vi.advanceTimersByTimeAsync(MIN);
    await sweeper?.idle();
    expect(await names(inbox)).toEqual([]);
    await sweeper?.stop();
  });

  it("survives a log that throws", async () => {
    vi.useFakeTimers();
    const inbox = join(base, "inbox");
    await file(join(inbox, "old.txt"), 90, Date.now());
    const sweeper = startSweeping(
      { inbox, maxBytes: 1024, maxAgeMin: 4 },
      {
        service: "svc",
        log: () => {
          throw new Error("stderr is gone");
        },
      },
    );
    await expect(sweeper?.idle()).resolves.toBeUndefined();
    await file(join(inbox, "second.txt"), 90, Date.now());
    await vi.advanceTimersByTimeAsync(MIN);
    await sweeper?.idle();
    expect(await names(inbox)).toEqual([]);
    await sweeper?.stop();
  });
});
