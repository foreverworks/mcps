import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asInputFileError, inputFilesWith } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import type { Deps, DrivePort } from "../../src/drive/app/ports.js";
import { listFolder, resolvePath } from "../../src/drive/app/usecases/browse.js";
import { readDoc } from "../../src/drive/app/usecases/content.js";
import { downloadFile } from "../../src/drive/app/usecases/download.js";
import { copyFile, makeFolder, move, pathOf, rename } from "../../src/drive/app/usecases/organise.js";
import { changesSince } from "../../src/drive/app/usecases/sync.js";
import { uploadFile } from "../../src/drive/app/usecases/upload.js";
import { DOCUMENT_MIME, FOLDER_MIME, type RawFile } from "../../src/drive/domain/entries.js";
import { asAppError, type AppError } from "../../src/drive/domain/errors.js";

/**
 * A Drive made of plain objects. Everything in this file exercises the layer
 * that decides, not the layer that talks, which is the whole reason the port
 * names operations rather than URLs.
 */
const makeFake = (
  files: Record<string, RawFile>,
  {
    roots = [],
    stores = (bytes: Uint8Array) => bytes,
    mirror,
    blobs = {},
    serves = (bytes: Uint8Array) => bytes,
    reportsChecksums = true,
  }: {
    roots?: string[];
    stores?: (bytes: Uint8Array) => Uint8Array;
    /** The Drive mirror's root, read as one more root of the reader. */
    mirror?: string;
    /** The bytes each file id holds on Drive, and what a download hands back of them. */
    blobs?: Record<string, Uint8Array>;
    serves?: (bytes: Uint8Array) => Uint8Array;
    /** Whether Drive reports checksums for what it stored; when not, a read back is the only check. */
    reportsChecksums?: boolean;
  } = {},
) => {
  const revisionsDeleted: { id: string; revisionId: string }[] = [];
  const writes: { id: string; patch: unknown }[] = [];
  const uploads: { kind: "new" | "replace"; id: string; bytes: Uint8Array; modifiedTime?: string }[] = [];
  const saved: { dir: string; name: string; bytes: Uint8Array }[] = [];
  const exported: { id: string; mime: string }[] = [];
  /** What Drive reports for bytes it stored: its two checksums, of what `stores` made of them. */
  const checksums = (bytes: Uint8Array) => {
    const kept = stores(bytes);
    return {
      size: String(kept.length),
      ...(reportsChecksums
        ? { sha256Checksum: createHash("sha256").update(kept).digest("hex"), md5Checksum: createHash("md5").update(kept).digest("hex") }
        : {}),
    };
  };
  const store = { ...files };
  let created = 0;

  // "root" and the root folder's real id name the same folder, exactly as on
  // Drive. The fixtures below use both, deliberately: code that confuses them
  // has to fail here rather than live.
  const ROOT_IDS = new Set(["root", "rootId"]);
  const sameFolder = (a: string, b: string): boolean => a === b || (ROOT_IDS.has(a) && ROOT_IDS.has(b));
  const childrenOf = (parentId: string): RawFile[] =>
    Object.values(store).filter((f) => (f.parents ?? []).some((p) => sameFolder(p, parentId)) && !f.trashed);

  const drive: DrivePort = {
    about: async () => ({ user: "owner@example.com", quotaUsedBytes: 1, quotaLimitBytes: 2 }),
    // Drive answers to "root" as an alias for the My Drive folder, and the
    // real id everywhere else. A fake that only knew one of the two would let
    // a walk that confuses them pass here and fail live.
    get: async (id) => {
      const found = id === "root" ? store["rootId"] : store[id];
      if (!found) throw new Error(`no file ${id}`);
      return found;
    },
    listChildren: async (parentId) => childrenOf(parentId === "root" ? "rootId" : parentId),
    childrenNamed: async (parentId, name) => childrenOf(parentId === "root" ? "rootId" : parentId).filter((f) => f.name === name),
    search: async () => [],
    createFile: async (name, mimeType, parentId) => {
      created += 1;
      const id = `new${created}`;
      const made: RawFile = { id, name, mimeType, parents: [parentId] };
      store[id] = made;
      return made;
    },
    copy: async (id, name, parentId) => ({ ...(store[id] as RawFile), id: `copy-of-${id}`, name, parents: [parentId] }),
    update: async (id, patch) => {
      writes.push({ id, patch });
      const before = store[id] as RawFile;
      const after: RawFile = { ...before, ...(patch.name === undefined ? {} : { name: patch.name }), ...(patch.trashed === undefined ? {} : { trashed: patch.trashed }) };
      store[id] = after;
      return after;
    },
    upload: async (parentId, file) => {
      created += 1;
      const id = `up${created}`;
      uploads.push({ kind: "new", id, bytes: file.bytes, ...(file.modifiedTime === undefined ? {} : { modifiedTime: file.modifiedTime }) });
      // A converted file is a Google file: Drive keeps no bytes and reports no checksum for it.
      const made: RawFile = file.convertTo
        ? { id, name: file.name, mimeType: file.convertTo, parents: [parentId], headRevisionId: "rev1" }
        : { id, name: file.name, mimeType: file.mimeType, parents: [parentId], headRevisionId: "rev1", ...checksums(file.bytes) };
      store[id] = made;
      blobs[id] = stores(file.bytes);
      return made;
    },
    replaceContent: async (id, file) => {
      uploads.push({ kind: "replace", id, bytes: file.bytes, ...(file.modifiedTime === undefined ? {} : { modifiedTime: file.modifiedTime }) });
      const after: RawFile = { ...(store[id] as RawFile), headRevisionId: "rev2", ...checksums(file.bytes) };
      store[id] = after;
      blobs[id] = stores(file.bytes);
      return after;
    },
    deleteRevision: async (id, revisionId) => {
      revisionsDeleted.push({ id, revisionId });
    },
    exportText: async () => "the words",
    download: async (id) => serves(blobs[id] ?? new Uint8Array()),
    exportBytes: async (id, mime) => {
      exported.push({ id, mime });
      return Buffer.from(`${id} as ${mime}`);
    },
    startPageToken: async () => "t0",
    changes: async () => ({ changes: [{ fileId: "f1", removed: false }], newStartPageToken: "t1" }),
    // Comments, sharing and revisions have their own tests (test/collaboration).
    ...Object.fromEntries(
      [
        "listComments", "createComment", "updateComment", "deleteComment", "createReply", "updateReply", "deleteReply",
        "listPermissions", "createPermission", "updatePermission", "deletePermission",
        "listRevisions", "updateRevision", "downloadRevision", "exportRevision",
      ].map((name) => [name, async () => { throw new Error(`${name} is not used here`); }]),
    ) as unknown as Pick<DrivePort, "listComments" | "createComment" | "updateComment" | "deleteComment" | "createReply" | "updateReply" | "deleteReply" | "listPermissions" | "createPermission" | "updatePermission" | "deletePermission" | "listRevisions" | "updateRevision" | "downloadRevision" | "exportRevision">,
  };

  const deps: Deps = {
    drive,
    grant: () => ({ source: "fake", detail: "test" }),
    readInput: inputFilesWith(mirror === undefined ? roots : [...roots, mirror]),
    ...(mirror === undefined ? {} : { mirror }),
    downloads: {
      dir: "/outbox/google/drive",
      save: async (dir, name, bytes) => {
        saved.push({ dir, name, bytes });
        return `${dir}/${name}`;
      },
    },
  };
  return { deps, writes, store, uploads, saved, exported, revisionsDeleted };
};


/**
 * The failure of a call that was supposed to fail.
 *
 * Asserting on `.catch(asAppError)` types the result as "the error OR the
 * success", so every assertion after it has to be cast. This narrows once, and
 * turns "it unexpectedly succeeded" into a readable failure instead of a
 * confusing one about a missing property.
 */
const failure = async (promise: Promise<unknown>): Promise<AppError> => {
  const thrown: unknown = await promise.then(
    (value) => {
      throw new Error(`expected a failure, got ${JSON.stringify(value)}`);
    },
    (e: unknown) => e,
  );
  const error = asAppError(thrown);
  if (error === undefined) throw thrown;
  return error;
};

const ROOT: RawFile = { id: "rootId", name: "My Drive", mimeType: FOLDER_MIME };

describe("resolvePath", () => {
  it("walks names down to an id", async () => {
    const { deps } = makeFake({
      rootId: ROOT,
      a: { id: "a", name: "Accounting", mimeType: FOLDER_MIME, parents: ["root"] },
      b: { id: "b", name: "Bookkeeper", mimeType: FOLDER_MIME, parents: ["a"] },
    });
    expect((await resolvePath(deps, "Accounting/Bookkeeper")).id).toBe("b");
  });

  // Drive lets two objects share one name in one folder; picking one would be
  // a coin flip that later writes.
  it("refuses a path two objects answer to, and names both", async () => {
    const { deps } = makeFake({
      rootId: ROOT,
      a: { id: "a", name: "Report.docx", mimeType: "application/vnd.google-apps.document", parents: ["root"] },
      b: { id: "b", name: "Report.docx", mimeType: "application/pdf", parents: ["root"] },
    });
    const error = await failure(resolvePath(deps, "Report.docx"));
    expect(error.kind).toBe("ambiguous");
    if (error.kind !== "ambiguous") return;
    expect(error.candidates).toHaveLength(2);
  });

  it("says which segment was missing, not just that the path failed", async () => {
    const { deps } = makeFake({ rootId: ROOT, a: { id: "a", name: "Accounting", mimeType: FOLDER_MIME, parents: ["root"] } });
    const error = await failure(resolvePath(deps, "Accounting/Nope"));
    expect(error).toMatchObject({ kind: "not_found", message: 'no "Nope" in Accounting' });
  });
});

describe("move", () => {
  const drive = () => ({
    rootId: ROOT,
    dest: { id: "dest", name: "Unsorted", mimeType: FOLDER_MIME, parents: ["root"] },
    f1: { id: "f1", name: "invoice.pdf", mimeType: "application/pdf", parents: ["root"], size: "10" },
  });

  it("writes nothing on a dry run but still returns the plan", async () => {
    const { deps, writes } = makeFake(drive());
    const result = await move(deps, {
      sources: ["invoice.pdf"],
      destinationPath: "Unsorted",
      destinationId: "",
      renameTo: "",
      dryRun: true,
    });
    expect(result.plan.willWrite).toBe(1);
    expect(writes).toHaveLength(0);
    expect(result.applied).toHaveLength(0);
  });

  it("moves out of every current parent, not just the one it was found by", async () => {
    const files = drive();
    files.f1 = { ...files.f1, parents: ["root", "other"] };
    const { deps, writes } = makeFake(files);
    await move(deps, { sources: ["id:f1"], destinationPath: "Unsorted", destinationId: "", renameTo: "", dryRun: false });
    expect(writes[0]?.patch).toMatchObject({ addParents: ["dest"], removeParents: ["root", "other"] });
  });

  it("refuses to rename a batch", async () => {
    const { deps } = makeFake(drive());
    const error = await failure(
      move(deps, { sources: ["a", "b"], destinationPath: "Unsorted", destinationId: "", renameTo: "x", dryRun: true }),
    );
    expect(error.kind).toBe("input");
    expect(error.message).toMatch(/rename_to moves one file/);
  });
});

describe("mkdir", () => {
  it("creates only the levels that are missing", async () => {
    const { deps } = makeFake({
      rootId: ROOT,
      legal: { id: "legal", name: "Legal", mimeType: FOLDER_MIME, parents: ["root"] },
    });
    const result = await makeFolder(deps, "Legal/Templates/Archive");
    expect(result.created).toEqual(["Templates", "Archive"]);
  });

  it("refuses when a name on the way down is a file", async () => {
    const { deps } = makeFake({
      rootId: ROOT,
      f: { id: "f", name: "Legal", mimeType: "application/pdf", parents: ["root"] },
    });
    const error = await failure(makeFolder(deps, "Legal/Templates"));
    expect(error.kind).toBe("input");
    expect(error.message).toMatch(/exists and is not a folder/);
  });
});

describe("rename", () => {
  it("refuses a slash, because Drive has parents and not paths", async () => {
    const { deps } = makeFake({ rootId: ROOT, f: { id: "f", name: "a.pdf", mimeType: "application/pdf", parents: ["root"] } });
    const error = await failure(rename(deps, { fileId: "f", path: "", newName: "a/b.pdf" }));
    expect(error.kind).toBe("input");
  });
});

describe("pathOf", () => {
  it("stops at the root's real id rather than the alias", async () => {
    const { deps } = makeFake({
      rootId: ROOT,
      a: { id: "a", name: "Accounting", mimeType: FOLDER_MIME, parents: ["rootId"] },
      b: { id: "b", name: "x.pdf", mimeType: "application/pdf", parents: ["a"] },
    });
    expect(await pathOf(deps, "b")).toBe("Accounting/x.pdf");
  });
});

describe("read_doc", () => {
  it("refuses a binary file and says where its bytes are", async () => {
    const { deps } = makeFake({ rootId: ROOT, f: { id: "f", name: "a.pdf", mimeType: "application/pdf", parents: ["root"] } });
    const error = await failure(readDoc(deps, { fileId: "f", path: "", format: "text", maxChars: 100 }));
    expect(error.kind).toBe("input");
    expect(error.message).toMatch(/download_file/);
  });

  it("flags truncation rather than returning a short document silently", async () => {
    const { deps } = makeFake({
      rootId: ROOT,
      d: { id: "d", name: "Notes", mimeType: "application/vnd.google-apps.document", parents: ["root"] },
    });
    const whole = await readDoc(deps, { fileId: "d", path: "", format: "text", maxChars: 100 });
    expect(whole).toMatchObject({ truncated: false, text: "the words", exportedAs: "text/plain" });

    const clipped = await readDoc(deps, { fileId: "d", path: "", format: "text", maxChars: 5 });
    expect(clipped).toMatchObject({ truncated: true, text: "the w" });
  });
});

describe("changes", () => {
  it("reports caught up and hands back the new start token", async () => {
    const { deps } = makeFake({ rootId: ROOT });
    const report = await changesSince(deps, { cursor: "t0", limit: 10 });
    expect(report.exhausted).toBe(true);
    expect(report.cursor).toBe("t1");
    expect(report.changes[0]).toMatchObject({ fileId: "f1", removed: false, entry: null });
  });
});

describe("the root is addressable", () => {
  // It is the only folder with no name, so an empty path has to mean it;
  // otherwise `list` and `move` can reach every folder but the top one.
  it("lists the root when neither id nor path is given", async () => {
    const { deps } = makeFake({
      rootId: ROOT,
      a: { id: "a", name: "Accounting", mimeType: FOLDER_MIME, parents: ["root"] },
    });
    const result = await listFolder(deps, { fileId: "", path: "", includeTrashed: false, limit: 10 });
    expect(result.entries.map((e) => e.name)).toEqual(["Accounting"]);
  });

  it("moves into the root when the destination is empty", async () => {
    const { deps, writes } = makeFake({
      rootId: ROOT,
      f: { id: "f", name: "x.pdf", mimeType: "application/pdf", parents: ["sub"] },
      sub: { id: "sub", name: "Sub", mimeType: FOLDER_MIME, parents: ["root"] },
    });
    await move(deps, { sources: ["id:f"], destinationPath: "", destinationId: "", renameTo: "", dryRun: false });
    expect(writes[0]?.patch).toMatchObject({ addParents: ["root"], removeParents: ["sub"] });
  });
});

describe("uploadFile", () => {
  const root: RawFile = { id: "rootId", name: "My Drive", mimeType: FOLDER_MIME };
  const accounting: RawFile = { id: "acc", name: "Accounting", mimeType: FOLDER_MIME, parents: ["rootId"] };
  const zip = Buffer.from("PK\u0003\u0004 an e-Factura archive, binary \u0000\u00ff", "latin1");
  const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const inbox = () => {
    const dir = mkdtempSync(join(tmpdir(), "drive-inbox-"));
    writeFileSync(join(dir, "1234567890.zip"), zip);
    return dir;
  };
  const args = { folderId: "", folderPath: "Accounting", name: "", mimeType: "", ifExists: "fail" as const };

  it("uploads a file from the inbox into a folder by path, and proves it by Drive's own sha256", async () => {
    const dir = inbox();
    const { deps, uploads } = makeFake({ rootId: root, acc: accounting }, { roots: [dir] });
    const out = await uploadFile(deps, { ...args, source: { path: "1234567890.zip" } });
    expect(out).toMatchObject({ id: "up1", name: "1234567890.zip", mimeType: "application/zip", replaced: false, size: zip.length, sha256: sha(zip), verifiedBy: "sha256" });
    expect(Buffer.from(uploads[0]?.bytes ?? []).equals(zip)).toBe(true);
  });

  it("refuses a name already there unless told, and replaces the one file of that name as a new revision", async () => {
    const dir = inbox();
    const old: RawFile = { id: "z1", name: "1234567890.zip", mimeType: "application/zip", parents: ["acc"] };
    const { deps, uploads } = makeFake({ rootId: root, acc: accounting, z1: old }, { roots: [dir] });
    expect(await failure(uploadFile(deps, { ...args, source: { path: "1234567890.zip" } }))).toMatchObject({ kind: "input", message: expect.stringMatching(/z1/) });
    expect(uploads).toEqual([]);
    const out = await uploadFile(deps, { ...args, source: { path: "1234567890.zip" }, ifExists: "replace" });
    expect(out).toMatchObject({ id: "z1", replaced: true, verifiedBy: "sha256" });
    expect(uploads.map((u) => u.kind)).toEqual(["replace"]);
  });

  it("refuses to choose between two files of one name, and to give bytes to a Doc", async () => {
    const dir = inbox();
    const twin = (id: string): RawFile => ({ id, name: "1234567890.zip", mimeType: "application/zip", parents: ["acc"] });
    const two = makeFake({ rootId: root, acc: accounting, a: twin("a"), b: twin("b") }, { roots: [dir] });
    expect(await failure(uploadFile(two.deps, { ...args, source: { path: "1234567890.zip" }, ifExists: "replace" }))).toMatchObject({ kind: "ambiguous" });
    const doc: RawFile = { id: "d", name: "Notes", mimeType: "application/vnd.google-apps.document", parents: ["acc"] };
    const docs = makeFake({ rootId: root, acc: accounting, d: doc }, { roots: [dir] });
    expect(await failure(uploadFile(docs.deps, { ...args, name: "Notes", source: { path: "1234567890.zip" }, ifExists: "replace" }))).toMatchObject({ kind: "input" });
  });

  it("fails loudly when Drive stored other bytes, and trashes the damaged new file", async () => {
    const dir = inbox();
    const { deps, store } = makeFake({ rootId: root, acc: accounting }, { roots: [dir], stores: (b) => Buffer.concat([Buffer.from(b), Buffer.from("x")]) });
    expect(await failure(uploadFile(deps, { ...args, source: { path: "1234567890.zip" } }))).toMatchObject({
      kind: "api",
      message: expect.stringMatching(/reached Drive changed: Drive stored sha256 .*the damaged file up1 was moved to the trash/),
    });
    expect(store["up1"]?.trashed).toBe(true);
  });

  it("deletes a damaged replacement's revision, so the file holds its previous content again", async () => {
    const dir = inbox();
    const old: RawFile = { id: "z1", name: "1234567890.zip", mimeType: "application/zip", parents: ["acc"] };
    const { deps, revisionsDeleted } = makeFake({ rootId: root, acc: accounting, z1: old }, { roots: [dir], stores: (b) => Buffer.from(b).subarray(1) });
    expect(await failure(uploadFile(deps, { ...args, source: { path: "1234567890.zip" }, ifExists: "replace" }))).toMatchObject({
      message: expect.stringMatching(/damaged revision was deleted/),
    });
    expect(revisionsDeleted).toEqual([{ id: "z1", revisionId: "rev2" }]);
  });

  it("reads the stored bytes back when Drive reports no checksum", async () => {
    const dir = inbox();
    const good = makeFake({ rootId: root, acc: accounting }, { roots: [dir], reportsChecksums: false });
    expect(await uploadFile(good.deps, { ...args, source: { path: "1234567890.zip" } })).toMatchObject({ verifiedBy: "download" });
    const bad = makeFake({ rootId: root, acc: accounting }, { roots: [dir], reportsChecksums: false, stores: (b) => Buffer.from(b).subarray(1) });
    expect(await failure(uploadFile(bad.deps, { ...args, source: { path: "1234567890.zip" } }))).toMatchObject({ message: expect.stringMatching(/read back hash/) });
  });

  it("never uploads retyped base64 or a link, and needs a name for base64", async () => {
    const dir = inbox();
    symlinkSync("/etc/hostname", join(dir, "link.zip"));
    const { deps, uploads } = makeFake({ rootId: root, acc: accounting }, { roots: [dir] });
    const b64 = zip.toString("base64");
    const typo = `${b64.slice(0, 8)}${b64[8] === "2" ? "6" : "2"}${b64.slice(9)}`;
    const typed = await uploadFile(deps, { ...args, source: { contentBase64: typo, sha256: sha(zip), name: "a.zip" } }).catch((t: unknown) => asInputFileError(t));
    expect(typed).toMatchObject({ kind: "checksum_mismatch" });
    const linked = await uploadFile(deps, { ...args, source: { path: "link.zip" } }).catch((t: unknown) => asInputFileError(t));
    expect(linked).toMatchObject({ code: "symlink" });
    expect(await failure(uploadFile(deps, { ...args, source: { contentBase64: b64, sha256: sha(zip) } }))).toMatchObject({ kind: "input" });
    expect(uploads).toEqual([]);
    expect(await uploadFile(deps, { ...args, source: { contentBase64: b64, sha256: sha(zip), name: "a.zip" } })).toMatchObject({ name: "a.zip", verifiedBy: "sha256" });
  });
});


describe("uploadFile with convert", () => {
  const root: RawFile = { id: "rootId", name: "My Drive", mimeType: FOLDER_MIME };
  const reports: RawFile = { id: "rep", name: "Reports", mimeType: FOLDER_MIME, parents: ["rootId"] };
  const docx = Buffer.from("PK\u0003\u0004 word/document.xml, invented", "latin1");
  const inbox = (name = "Q3 report.docx") => {
    const dir = mkdtempSync(join(tmpdir(), "drive-inbox-"));
    writeFileSync(join(dir, name), docx);
    return dir;
  };
  const args = { folderId: "", folderPath: "Reports", name: "", mimeType: "", ifExists: "fail" as const, convert: true };

  it("sends a .docx with its own type and asks Drive for a Google Doc, named as Drive names a converted file", async () => {
    const { deps, uploads, store } = makeFake({ rootId: root, rep: reports }, { roots: [inbox()] });
    const out = await uploadFile(deps, { ...args, source: { path: "Q3 report.docx" } });
    expect(out).toMatchObject({
      id: "up1",
      name: "Q3 report",
      mimeType: DOCUMENT_MIME,
      converted: { from: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", to: DOCUMENT_MIME },
      source: { size: docx.length, sha256: createHash("sha256").update(docx).digest("hex") },
    });
    expect(out).not.toHaveProperty("verifiedBy");
    expect(Buffer.from(uploads[0]?.bytes ?? []).equals(docx)).toBe(true);
    expect(store["up1"]?.parents).toEqual(["rep"]);
  });

  it("refuses, before anything is sent, a type that does not convert, a replace, and a name already there", async () => {
    const dir = inbox();
    writeFileSync(join(dir, "a.zip"), docx);
    const taken: RawFile = { id: "old", name: "Q3 report", mimeType: DOCUMENT_MIME, parents: ["rep"] };
    const { deps, uploads } = makeFake({ rootId: root, rep: reports, old: taken }, { roots: [dir] });
    expect(await failure(uploadFile(deps, { ...args, source: { path: "a.zip" } }))).toMatchObject({ kind: "input", message: expect.stringMatching(/does not convert/) });
    expect(await failure(uploadFile(deps, { ...args, ifExists: "replace", source: { path: "Q3 report.docx" } }))).toMatchObject({ kind: "input" });
    expect(await failure(uploadFile(deps, { ...args, source: { path: "Q3 report.docx" } }))).toMatchObject({ kind: "input", message: expect.stringMatching(/old/) });
    expect(uploads).toEqual([]);
    const both = await uploadFile(deps, { ...args, ifExists: "keep_both", source: { path: "Q3 report.docx" } });
    expect(both).toMatchObject({ name: "Q3 report", mimeType: DOCUMENT_MIME });
  });

  it("takes the type from the source's own name when filename gives the Google file another, and keeps a name's other dots", async () => {
    const { deps } = makeFake({ rootId: root, rep: reports }, { roots: [inbox("Report v2.1.docx")] });
    expect(await uploadFile(deps, { ...args, name: "Budget 2026", source: { path: "Report v2.1.docx", name: "Budget 2026" } })).toMatchObject({ name: "Budget 2026", mimeType: DOCUMENT_MIME });
    expect(await uploadFile(deps, { ...args, source: { path: "Report v2.1.docx" } })).toMatchObject({ name: "Report v2.1", mimeType: DOCUMENT_MIME });
  });

  it("trashes what Drive stored as anything but the Google type, and fails", async () => {
    const fake = makeFake({ rootId: root, rep: reports }, { roots: [inbox()] });
    const deps: Deps = { ...fake.deps, drive: { ...fake.deps.drive, upload: async (parentId, file) => ({ id: "kept", name: file.name, mimeType: file.mimeType, parents: [parentId] }) } };
    const error = await failure(uploadFile(deps, { ...args, source: { path: "Q3 report.docx" } }));
    expect(error).toMatchObject({ kind: "api", message: expect.stringMatching(/trash/) });
    expect(fake.writes).toContainEqual({ id: "kept", patch: { trashed: true } });
  });
});

describe("uploadFile from the Drive mirror", () => {
  const root: RawFile = { id: "rootId", name: "My Drive", mimeType: FOLDER_MIME };
  const branding: RawFile = { id: "brand", name: "Branding", mimeType: FOLDER_MIME, parents: ["rootId"] };
  const accounting: RawFile = { id: "acc", name: "Accounting", mimeType: FOLDER_MIME, parents: ["rootId"] };
  const pdf = Buffer.from("%PDF-1.7 a logo\n%%EOF\n");
  const when = new Date("2026-01-01T12:00:00.123Z");
  const args = { folderId: "", folderPath: "", name: "", mimeType: "", ifExists: "fail" as const };
  const mirrorWith = () => {
    const mirror = mkdtempSync(join(tmpdir(), "drive-mirror-"));
    mkdirSync(join(mirror, "Branding"));
    for (const path of ["Branding/logo.pdf", "RCLONE_TEST"]) {
      writeFileSync(join(mirror, path), pdf);
      utimesSync(join(mirror, path), when, when);
    }
    return mirror;
  };

  it("sends a file read in the mirror to the folder it mirrors, carrying its modification time", async () => {
    const mirror = mirrorWith();
    const { deps, uploads } = makeFake({ rootId: root, brand: branding }, { mirror });
    const out = await uploadFile(deps, { ...args, source: { path: join(mirror, "Branding/logo.pdf") } });
    expect(out).toMatchObject({ name: "logo.pdf", parents: ["brand"], mirroredFolder: "Branding", verifiedBy: "sha256" });
    expect(uploads).toMatchObject([{ kind: "new", modifiedTime: when.toISOString() }]);
  });

  it("gives the mirrored copy on Drive the new bytes as a revision, with the same time", async () => {
    const mirror = mirrorWith();
    const old: RawFile = { id: "logo", name: "logo.pdf", mimeType: "application/pdf", parents: ["brand"] };
    const { deps, uploads } = makeFake({ rootId: root, brand: branding, logo: old }, { mirror });
    const out = await uploadFile(deps, { ...args, source: { path: join(mirror, "Branding/logo.pdf") }, ifExists: "replace" });
    expect(out).toMatchObject({ id: "logo", replaced: true, mirroredFolder: "Branding" });
    expect(uploads).toMatchObject([{ kind: "replace", id: "logo", modifiedTime: when.toISOString() }]);
  });

  it("lets a folder asked for win over the mirrored one, and sends a file at the mirror's top to the root", async () => {
    const mirror = mirrorWith();
    const { deps } = makeFake({ rootId: root, brand: branding, acc: accounting }, { mirror });
    const elsewhere = await uploadFile(deps, { ...args, folderPath: "Accounting", source: { path: join(mirror, "Branding/logo.pdf") } });
    expect(elsewhere).toMatchObject({ parents: ["acc"], mirroredFolder: "Branding" });
    const top = await uploadFile(deps, { ...args, source: { path: join(mirror, "RCLONE_TEST") } });
    expect(top).toMatchObject({ parents: ["root"], mirroredFolder: "" });
  });

  it("treats a file from the inbox as before: the root unless told, and no mirrored folder", async () => {
    const mirror = mirrorWith();
    const inbox = mkdtempSync(join(tmpdir(), "drive-inbox-"));
    writeFileSync(join(inbox, "a.pdf"), pdf);
    const { deps } = makeFake({ rootId: root, brand: branding }, { roots: [inbox], mirror });
    const out = await uploadFile(deps, { ...args, source: { path: "a.pdf" } });
    expect(out).toMatchObject({ parents: ["root"] });
    expect(out).not.toHaveProperty("mirroredFolder");
  });
});

describe("downloadFile", () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  const hash = (algorithm: string, bytes: Uint8Array) => createHash(algorithm).update(bytes).digest("hex");
  const logo: RawFile = {
    id: "svg",
    name: "logo.svg",
    mimeType: "image/svg+xml",
    size: String(svg.length),
    md5Checksum: hash("md5", svg),
    sha256Checksum: hash("sha256", svg),
  };
  const doc: RawFile = { id: "doc", name: "Weekly sync - 2030/01/15", mimeType: "application/vnd.google-apps.document" };
  const folder: RawFile = { id: "dir", name: "Branding", mimeType: FOLDER_MIME };
  const args = { fileId: "", path: "", format: "", saveDir: "", filename: "" };

  it("saves a file's bytes into the outbox only once they match Drive's own checksum", async () => {
    const { deps, saved } = makeFake({ svg: logo }, { blobs: { svg } });
    const out = await downloadFile(deps, { ...args, fileId: "svg", saveDir: "2026-10" });
    expect(out).toMatchObject({ id: "svg", path: "/outbox/google/drive/2026-10/logo.svg", size: svg.length, verifiedBy: "sha256" });
    expect(saved).toHaveLength(1);
    expect(Buffer.from(saved[0]?.bytes ?? []).equals(svg)).toBe(true);
  });

  it("saves nothing when the bytes that came down are not what Drive stores", async () => {
    const { deps, saved } = makeFake({ svg: logo }, { blobs: { svg }, serves: (b) => Buffer.concat([Buffer.from(b), Buffer.from("x")]) });
    expect(await failure(downloadFile(deps, { ...args, fileId: "svg" }))).toMatchObject({ kind: "api", message: expect.stringMatching(/nothing was saved/) });
    expect(saved).toEqual([]);
  });

  it("exports a Google file in its default format or the one asked for, under a name that is one path segment", async () => {
    const { deps, saved, exported } = makeFake({ doc });
    expect(await downloadFile(deps, { ...args, fileId: "doc" })).toMatchObject({ exportedAs: "pdf", path: "/outbox/google/drive/Weekly sync - 2030_01_15.pdf" });
    expect(await downloadFile(deps, { ...args, fileId: "doc", format: "docx", filename: "sync" })).toMatchObject({ exportedAs: "docx", path: "/outbox/google/drive/sync.docx" });
    expect(exported.map((e) => e.mime)).toEqual(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
    expect(await failure(downloadFile(deps, { ...args, fileId: "doc", format: "xlsx" }))).toMatchObject({ kind: "input", message: expect.stringMatching(/pdf, docx/) });
    expect(saved).toHaveLength(2);
  });

  it("refuses a folder, a format for a file with bytes, a folder outside the outbox, an oversize file, and no file at all", async () => {
    const big: RawFile = { ...logo, id: "big", size: String(200 * 1024 * 1024) };
    const { deps, saved } = makeFake({ svg: logo, dir: folder, big }, { blobs: { svg } });
    for (const wrong of [
      { ...args, fileId: "dir" },
      { ...args, fileId: "svg", format: "pdf" },
      { ...args, fileId: "svg", saveDir: "/etc" },
      { ...args, fileId: "svg", saveDir: "../escape" },
      { ...args, fileId: "big" },
      args,
    ]) {
      expect(await failure(downloadFile(deps, wrong))).toMatchObject({ kind: "input" });
    }
    expect(saved).toEqual([]);
  });

  it("says so where it has nowhere to save", async () => {
    const { deps } = makeFake({ svg: logo }, { blobs: { svg } });
    const { downloads: _none, ...nowhere } = deps;
    expect(await failure(downloadFile(nowhere, { ...args, fileId: "svg" }))).toMatchObject({ kind: "config" });
  });
});

describe("file copies", () => {
  const files = {
    source: { id: "source", name: "Ledger", mimeType: "application/vnd.google-apps.spreadsheet", modifiedTime: "v1", parents: ["old"] },
    destination: { id: "destination", name: "Backup", mimeType: FOLDER_MIME },
  };
  const args = { fileId: "source", destinationId: "destination", name: "", expectedModified: "v1" };
  it("retains native type without changing the original", async () => {
    const { deps, store, writes } = makeFake(files);
    const copied = await copyFile(deps, args);
    expect(copied).toMatchObject({ id: "copy-of-source", mimeType: files.source.mimeType, parents: ["destination"] });
    expect(store.source).toEqual(files.source);
    expect(writes).toEqual([]);
  });
  it("refuses stale source observations, folders and filename collisions", async () => {
    expect((await failure(copyFile(makeFake(files).deps, { ...args, expectedModified: "old" }))).kind).toBe("input");
    expect((await failure(copyFile(makeFake(files).deps, { ...args, fileId: "destination" }))).kind).toBe("input");
    expect((await failure(copyFile(makeFake({ ...files, existing: { id: "existing", name: "Ledger", parents: ["destination"] } }).deps, args))).kind).toBe("input");
  });
});
