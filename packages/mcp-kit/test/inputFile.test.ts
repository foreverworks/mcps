import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { asFailure } from "../src/envelope.js";
import { decodeBase64Strict, parseSha256 } from "../src/inputFile/bytes.js";
import { fileRootsFrom, isInside } from "../src/inputFile/roots.js";
import { inputFilesFrom, inputFilesWith, readInputFile } from "../src/inputFile.js";
import { asInputFileError, type InputFileError } from "../src/inputFileErrors.js";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

const failureOf = async (p: Promise<unknown>): Promise<InputFileError | undefined> => {
  try {
    await p;
  } catch (thrown) {
    return asInputFileError(thrown);
  }
  throw new Error("expected a failure");
};

describe("decodeBase64Strict", () => {
  it("takes standard base64 with its padding, wrapped or not", () => {
    expect(decodeBase64Strict("aGVsbG8K")?.toString()).toBe("hello\n");
    expect(decodeBase64Strict("aGVs\nbG8K\n")?.toString()).toBe("hello\n");
    expect(decodeBase64Strict("QQ==")).toEqual(Buffer.from("A"));
    expect(decodeBase64Strict("")).toEqual(Buffer.alloc(0));
  });

  it("refuses what Node's decoder would quietly turn into other bytes", () => {
    expect(decodeBase64Strict("QQ")).toBeUndefined(); // no padding
    expect(decodeBase64Strict("QR==")).toBeUndefined(); // bits after the last byte
    expect(decodeBase64Strict("a-_b")).toBeUndefined(); // URL-safe alphabet
    expect(decodeBase64Strict("aGVs*G8K")).toBeUndefined(); // a stray character
    expect(decodeBase64Strict("QQ==QQ==")).toBeUndefined(); // padding in the middle
  });
});

describe("parseSha256", () => {
  it("takes what sha256sum prints, in either case", () => {
    expect(parseSha256(` ${sha("x").toUpperCase()}\n`)).toBe(sha("x"));
    expect(parseSha256("abc")).toBeUndefined();
    expect(parseSha256(`${sha("x")}  file.pdf`)).toBeUndefined();
  });
});

describe("fileRootsFrom", () => {
  it("is MCP_FILE_ROOTS when set, the working directory over stdio, and nothing over HTTP", () => {
    expect(fileRootsFrom({ MCP_FILE_ROOTS: "/srv/inbox/google:inbox2: " }, "/srv")).toEqual(["/srv/inbox/google", "/srv/inbox2"]);
    expect(fileRootsFrom({}, "/home/me/work")).toEqual(["/home/me/work"]);
    expect(fileRootsFrom({ MCP_HTTP_PORT: "3000" }, "/srv/app/servers/example")).toEqual([]);
    expect(fileRootsFrom({ MCP_HTTP_PORT: "3000", MCP_FILE_ROOTS: "/in" }, "/x")).toEqual(["/in"]);
  });

  it("knows inside from a sibling that shares a prefix", () => {
    expect(isInside("/in/google", "/in/google/a.pdf")).toBe(true);
    expect(isInside("/in/google", "/in/google/..x/a.pdf")).toBe(true);
    expect(isInside("/in/google", "/in/google2/a.pdf")).toBe(false);
    expect(isInside("/in/google", "/in/x")).toBe(false);
  });
});

describe("readInputFile", () => {
  let dir: string;
  let inbox: string;
  let grants: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mcp-kit-input-"));
    inbox = join(dir, "inbox");
    grants = join(dir, "state");
    await mkdir(inbox);
    await mkdir(grants);
    await writeFile(join(grants, "credentials.json"), '{"refresh_token":"secret"}');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const pdf = Buffer.from("%PDF-1.7\nâãÏÓ binary \u0000ÿ bytes\n%%EOF\n", "latin1");

  it("reads a file in a root by its path, absolute or relative to the first root", async () => {
    await writeFile(join(inbox, "invoice.pdf"), pdf);
    const byAbsolute = await readInputFile({ path: join(inbox, "invoice.pdf") }, { roots: [inbox] });
    expect(byAbsolute).toEqual({
      bytes: pdf,
      sha256: sha(pdf),
      size: pdf.length,
      name: "invoice.pdf",
      path: await realpath(join(inbox, "invoice.pdf")),
      modified: expect.any(Date),
    });
    const byRelative = await readInputFile({ path: "invoice.pdf", name: "Factura 12.pdf" }, { roots: [inbox, grants] });
    expect(byRelative).toMatchObject({ sha256: sha(pdf), name: "Factura 12.pdf" });
    expect(await readInputFile({ path: "invoice.pdf", sha256: sha(pdf) }, { roots: [inbox] })).toMatchObject({ size: pdf.length });
  });

  it("says which file it opened and when that file was last changed, and nothing of the kind for base64", async () => {
    const sub = join(inbox, "assets");
    await mkdir(sub);
    await writeFile(join(sub, "logo.pdf"), pdf);
    const when = new Date("2026-01-02T03:04:05.678Z");
    await utimes(join(sub, "logo.pdf"), when, when);
    const read = await readInputFile({ path: join(sub, "logo.pdf") }, { roots: [grants, inbox] });
    expect(read.path).toBe(await realpath(join(sub, "logo.pdf")));
    expect(read.modified?.toISOString()).toBe(when.toISOString());
    const sent = await readInputFile({ contentBase64: pdf.toString("base64"), sha256: sha(pdf), name: "logo.pdf" }, { roots: [inbox] });
    expect(sent).not.toHaveProperty("path");
    expect(sent).not.toHaveProperty("modified");
  });

  it("refuses a path outside every root, and any path where it has none", async () => {
    expect(await failureOf(readInputFile({ path: join(grants, "credentials.json") }, { roots: [inbox] }))).toMatchObject({
      kind: "input",
      code: "outside_roots",
    });
    expect(await failureOf(readInputFile({ path: "../state/credentials.json" }, { roots: [inbox] }))).toMatchObject({ code: "outside_roots" });
    expect(await failureOf(readInputFile({ path: "a.pdf" }, { roots: [] }))).toMatchObject({ code: "no_roots" });
    expect(await failureOf(readInputFile({ path: "missing.pdf" }, { roots: [inbox] }))).toMatchObject({ code: "not_found" });
  });

  it("refuses a symbolic link to the service's own grants, at the end of the path or in the middle", async () => {
    await symlink(join(grants, "credentials.json"), join(inbox, "invoice.pdf"));
    expect(await failureOf(readInputFile({ path: "invoice.pdf" }, { roots: [inbox] }))).toMatchObject({ code: "symlink" });
    await symlink(grants, join(inbox, "folder"));
    expect(await failureOf(readInputFile({ path: "folder/credentials.json" }, { roots: [inbox] }))).toMatchObject({
      code: "outside_roots",
      message: expect.stringMatching(/through a link/),
    });
  });

  it("refuses a link even to a file inside the root: the file itself goes in", async () => {
    await writeFile(join(inbox, "real.pdf"), pdf);
    await symlink(join(inbox, "real.pdf"), join(inbox, "alias.pdf"));
    expect(await failureOf(readInputFile({ path: "alias.pdf" }, { roots: [inbox] }))).toMatchObject({ code: "symlink" });
  });

  it("refuses what is not a regular file, without waiting on a pipe", async () => {
    await mkdir(join(inbox, "dir"));
    expect(await failureOf(readInputFile({ path: "dir" }, { roots: [inbox] }))).toMatchObject({ code: "not_a_file" });
    execFileSync("mkfifo", [join(inbox, "pipe")]);
    expect(await failureOf(readInputFile({ path: "pipe" }, { roots: [inbox] }))).toMatchObject({ code: "not_a_file" });
  });

  it("refuses a file over the cap", async () => {
    await writeFile(join(inbox, "big.bin"), Buffer.alloc(1025));
    expect(await failureOf(readInputFile({ path: "big.bin" }, { roots: [inbox], maxBytes: 1024 }))).toMatchObject({ code: "too_large" });
    expect(await readInputFile({ path: "big.bin" }, { roots: [inbox], maxBytes: 1025 })).toMatchObject({ size: 1025 });
    const big = Buffer.alloc(4096);
    expect(await failureOf(readInputFile({ contentBase64: big.toString("base64"), sha256: sha(big) }, { roots: [], maxBytes: 1024 }))).toMatchObject({
      code: "too_large",
    });
  });

  it("takes base64 only with the source's sha256, and refuses one character's difference", async () => {
    const b64 = pdf.toString("base64");
    expect(await readInputFile({ contentBase64: b64, sha256: sha(pdf), name: "a.pdf" }, { roots: [] })).toEqual({
      bytes: pdf,
      sha256: sha(pdf),
      size: pdf.length,
      name: "a.pdf",
    });
    expect(await failureOf(readInputFile({ contentBase64: b64 }, { roots: [] }))).toMatchObject({ code: "sha256_required" });
    expect(await failureOf(readInputFile({ contentBase64: b64, sha256: "md5ish" }, { roots: [] }))).toMatchObject({ code: "bad_sha256" });
    expect(await failureOf(readInputFile({ contentBase64: `${b64}!`, sha256: sha(pdf) }, { roots: [] }))).toMatchObject({ code: "bad_base64" });

    // One base64 character retyped, 2 -> 6, and Node decodes it without a word.
    const typo = `${b64.slice(0, 8)}${b64[8] === "2" ? "6" : "2"}${b64.slice(9)}`;
    const typed = Buffer.from(typo, "base64");
    const failure = await failureOf(readInputFile({ contentBase64: typo, sha256: sha(pdf) }, { roots: [] }));
    expect(failure).toEqual({
      kind: "checksum_mismatch",
      message: expect.stringContaining(sha(typed)),
      expected_sha256: sha(pdf),
      actual_sha256: sha(typed),
      size: typed.length,
    });
  });

  it("checks a sha256 given with a path too", async () => {
    await writeFile(join(inbox, "invoice.pdf"), pdf);
    expect(await failureOf(readInputFile({ path: "invoice.pdf", sha256: sha("other") }, { roots: [inbox] }))).toMatchObject({
      kind: "checksum_mismatch",
      expected_sha256: sha("other"),
      actual_sha256: sha(pdf),
    });
  });

  it("takes the file exactly one way", async () => {
    expect(await failureOf(readInputFile({}, { roots: [inbox] }))).toMatchObject({ code: "source" });
    expect(await failureOf(readInputFile({ path: "a", contentBase64: "", sha256: sha("") }, { roots: [inbox] }))).toMatchObject({ code: "source" });
  });

  it("binds a reader to the process's roots, and says them in the words a tool description uses", async () => {
    await writeFile(join(inbox, "a.txt"), "a");
    const read = inputFilesFrom({ MCP_FILE_ROOTS: inbox, MCP_HTTP_PORT: "1", MCP_FILE_SCRIPT: "send-it <file>" });
    expect(read.roots).toEqual([inbox]);
    expect(await read({ path: "a.txt" })).toMatchObject({ sha256: sha("a") });
    expect(read.help).toBe(
      `Never type or paste a file's base64 yourself: a retyped file can arrive changed. Copy the file into ${inbox} and give its path, ` +
        "or have a script that read the file send content_base64 with its sha256 (send-it <file>).",
    );
    expect(read.where).toContain(`a file in ${inbox}`);
    const none = inputFilesFrom({ MCP_HTTP_PORT: "1" });
    expect(none.roots).toEqual([]);
    expect(none.help).toMatch(/takes no paths here: have a script/);
    expect(inputFilesWith(["/home/me/work"]).help).toContain("Copy the file into /home/me/work");
  });

  it("reaches a tool's caller as a failure with the kit's remedy", async () => {
    const thrown = await readInputFile({ contentBase64: "QQ==", sha256: sha("B") }, { roots: [] }).catch((t: unknown) => t);
    const result = asFailure(thrown, { asAppError: () => undefined, remedyFor: () => "" });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: {
        kind: "checksum_mismatch",
        message: expect.any(String),
        expected_sha256: sha("B"),
        actual_sha256: sha("A"),
        size: 1,
        remedy: expect.stringMatching(/nothing was stored or sent/),
      },
    });
  });
});
