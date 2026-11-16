import { lstat, mkdir, mkdtemp, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { HandedBack } from "../src/handedBack.js";
import { makeOwnFiles, type OwnFiles } from "../src/serve/ownFiles.js";

const MINUTE = 60_000;

describe("the record of the files a held client's calls handed back", () => {
  let dir: string;
  let outbox: string;
  let clock: { now: number };
  let own: OwnFiles;

  const write = async (name: string, text: string): Promise<{ path: string; size: number }> => {
    const path = join(outbox, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, text);
    return { path, size: Buffer.byteLength(text) };
  };
  const statOf = (path: string) => lstat(path, { bigint: true });
  /** What the outbox writer notes: the path, the size, and the file's stats as it was written. */
  const noted = async (entries: readonly (readonly [string, number])[]): Promise<Map<string, HandedBack>> =>
    new Map(await Promise.all(entries.map(async ([path, size]) => [path, { size, stats: await statOf(path).catch(() => undefined) }] as const)));
  const holdsNow = async (client: string, path: string): Promise<boolean> => own.holds(client, path, await statOf(path));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mcp-kit-own-files-"));
    outbox = join(dir, "out");
    await mkdir(outbox);
    clock = { now: Date.UTC(2026, 8, 1, 9, 0) };
    own = makeOwnFiles({ outbox, maxAgeMs: 30 * MINUTE, maxPerClient: 3, now: () => clock.now });
  });

  it("holds a file for the client whose call handed it back, and for no other", async () => {
    const file = await write("2026-09/statement.pdf", "statement of account");
    own.record("reader", await noted([[file.path, file.size]]));
    expect(own.has("reader", file.path)).toBe(true);
    expect(await holdsNow("reader", file.path)).toBe(true);
    expect(own.has("other", file.path)).toBe(false);
    expect(await holdsNow("other", file.path)).toBe(false);
  });

  it("knows a path written another way to the same place", async () => {
    const file = await write("a.txt", "abc");
    await mkdir(join(outbox, "x"));
    own.record("reader", await noted([[`${outbox}/x/../a.txt`, file.size]]));
    expect(await holdsNow("reader", join(outbox, "a.txt"))).toBe(true);
  });

  it("records nothing outside the outbox, nothing that is not a regular file, and nothing whose size is not the one noted", async () => {
    const outside = join(dir, "elsewhere.txt");
    await writeFile(outside, "not in the outbox");
    const link = join(outbox, "link.txt");
    const target = await write("target.txt", "target");
    await symlink(target.path, link);
    await mkdir(join(outbox, "folder"));
    const grown = await write("grown.txt", "longer than noted");
    own.record(
      "reader",
      await noted([
        [outside, 17],
        [link, 6],
        [join(outbox, "folder"), 0],
        [grown.path, 3],
        [join(outbox, "missing.txt"), 1],
        [outbox, 0],
      ]),
    );
    for (const path of [outside, link, join(outbox, "folder"), grown.path, join(outbox, "missing.txt"), outbox]) expect(own.has("reader", path)).toBe(false);
  });

  it("does not hold another file put at the recorded path later, or a link put there", async () => {
    const file = await write("report.txt", "first report");
    own.record("reader", await noted([[file.path, file.size]]));
    const recorded = await statOf(file.path);
    // Written whole beside it and renamed into place, as the outbox writer does: same path, same size, another file.
    await writeFile(join(outbox, "report.txt.tmp"), "other report");
    await rename(join(outbox, "report.txt.tmp"), file.path);
    expect(own.has("reader", file.path)).toBe(true);
    expect(await holdsNow("reader", file.path)).toBe(false);
    expect(own.holds("reader", file.path, recorded)).toBe(true);

    const mine = await write("mine.txt", "mine");
    own.record("reader", await noted([[mine.path, mine.size]]));
    const other = await write("other.txt", "theirs");
    await unlink(mine.path);
    await symlink(other.path, mine.path);
    expect(own.holds("reader", mine.path, await lstat(other.path, { bigint: true }))).toBe(false);
  });

  it("records the file as it was noted, not what is at the path by the time the call ends", async () => {
    const file = await write("x.txt", "mine");
    const asWritten = await noted([[file.path, file.size]]);
    // Another call puts a file of the same size at the same path before this one has ended.
    await writeFile(join(outbox, "x.txt.tmp"), "THEM");
    await rename(join(outbox, "x.txt.tmp"), file.path);
    own.record("reader", asWritten);
    expect(own.has("reader", file.path)).toBe(true);
    expect(await holdsNow("reader", file.path)).toBe(false);
  });

  it("forgets a record after the age, and keeps it until then", async () => {
    const file = await write("a.txt", "abc");
    own.record("reader", await noted([[file.path, file.size]]));
    clock.now += 30 * MINUTE;
    expect(await holdsNow("reader", file.path)).toBe(true);
    clock.now += 1;
    expect(own.has("reader", file.path)).toBe(false);
    expect(await holdsNow("reader", file.path)).toBe(false);
    // Recorded again, it is fresh again.
    own.record("reader", await noted([[file.path, file.size]]));
    expect(await holdsNow("reader", file.path)).toBe(true);
  });

  it("keeps at most so many records for a client, dropping the oldest first, and counts each client apart", async () => {
    const files = await Promise.all(["1", "2", "3", "4"].map((n) => write(`${n}.txt`, n)));
    for (const file of files.slice(0, 3)) {
      own.record("reader", await noted([[file.path, file.size]]));
      clock.now += MINUTE;
    }
    // Recorded again, the first is the newest, so the second is the one to go.
    own.record("reader", await noted([[(files[0] as { path: string }).path, 1]]));
    own.record("reader", await noted([[(files[3] as { path: string }).path, 1]]));
    expect(files.map((file) => own.has("reader", file.path))).toEqual([true, false, true, true]);
    own.record("other", await noted(files.map((file) => [file.path, file.size] as const)));
    expect(files.map((file) => own.has("other", file.path))).toEqual([false, true, true, true]);
    expect(files.map((file) => own.has("reader", file.path))).toEqual([true, false, true, true]);
  });
});
