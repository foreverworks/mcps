/**
 * Files in and out of a page: uploaded by path to a files column or the body,
 * and Notion's own files saved to the outbox, each with its SHA-256. Fake
 * ports and a temp outbox; the wire shapes over a stubbed fetch.
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inputFilesWith } from "@foreverworks/mcp-kit";
import { describe, expect, it, vi } from "vitest";

import type { Deps } from "../src/app/ports.js";
import { downloadFiles, uploadFile } from "../src/app/usecases/files.js";
import { buildDeps } from "../src/composition.js";
import { fail } from "../src/domain/errors.js";
import { multipartFile, safeFileName, uniqueNames } from "../src/domain/files.js";
import { makeDownload } from "../src/infra/download.js";
import { COLUMNS, dataSource, errorOf, fakeDeps, ID, json, notionError, row, tokensDir, withFetch } from "./helpers.js";

const sha = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const UPLOAD = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const BLOCK = "12121212-1212-4212-8212-121212121212";
const TOGGLE = "13131313-1313-4313-8313-131313131313";

const hosted = (name: string, url: string) => ({ name, type: "file", file: { url, expiry_time: "2026-10-22T15:00:00.000Z" } });
const external = (name: string, url: string) => ({ name, type: "external", external: { url } });
const withDocs = (...files: unknown[]) => row({}, { Docs: { id: "dc", type: "files", files } });

const inbox = async (files: Record<string, Uint8Array>) => {
  const dir = await mkdtemp(join(tmpdir(), "notion-inbox-"));
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(dir, name), bytes);
  return dir;
};

const upload = (status = "uploaded") => ({ object: "file_upload", id: UPLOAD, status, filename: "x", content_type: "image/png", content_length: PNG.length, created_time: "x", last_edited_time: "x", expiry_time: null, upload_url: "u", in_trash: false }) as never;

const crm = (page = withDocs(), over: Parameters<typeof fakeDeps>[0]["work"] = {}, extra: Partial<Deps> = {}): Deps => ({
  ...fakeDeps({
    work: {
      getPage: async (id) => (id === ID.row ? page : fail({ kind: "not_shared", accounts: ["work"], message: "no" })),
      getDataSource: async () => dataSource({ properties: { ...COLUMNS, Docs: { id: "dc", name: "Docs", type: "files", files: {} } } }),
      createFileUpload: async () => upload("pending"),
      sendFileUpload: async () => upload(),
      appendFileBlock: async () => ({ object: "list", results: [{ object: "block", id: BLOCK }], next_cursor: null, has_more: false }) as never,
      updatePage: async () => page,
      ...over,
    },
  }),
  ...extra,
});

describe("upload_file", () => {
  it("uploads a file by path into a block at the end of the body, as the kind of block its type is", async () => {
    const dir = await inbox({ "chart.png": PNG });
    const send = vi.fn(async () => upload());
    const append = vi.fn(async () => ({ object: "list", results: [{ object: "block", id: BLOCK }], next_cursor: null, has_more: false }) as never);
    const create = vi.fn(async () => upload("pending"));
    const deps = crm(withDocs(), { createFileUpload: create, sendFileUpload: send, appendFileBlock: append }, { readInput: inputFilesWith([dir]) });
    const out = await uploadFile(deps, { page: ID.row, file: { path: "chart.png" }, replace: false });
    expect(out).toEqual({ account: "work", page: ID.row, title: "Acme", block: BLOCK, blockType: "image", file: { name: "chart.png", size: PNG.length, sha256: sha(PNG), contentType: "image/png" } });
    expect(create).toHaveBeenCalledWith("chart.png", "image/png");
    expect(Buffer.from((send.mock.calls[0] as unknown as [string, string, string, Uint8Array])[3])).toEqual(PNG);
    expect(append).toHaveBeenCalledWith(ID.row, "image", UPLOAD);
  });

  it("adds a file to a files column after its external links", async () => {
    const dir = await inbox({ "brief.pdf": PNG });
    const update = vi.fn(async () => withDocs());
    const deps = crm(withDocs(external("Spec", "https://example.com/p.pdf")), { updatePage: update }, { readInput: inputFilesWith([dir]) });
    const out = await uploadFile(deps, { page: ID.row, file: { path: "brief.pdf" }, column: "docs", name: "Scope.pdf", replace: false });
    expect(out).toMatchObject({ column: "Docs", file: { name: "Scope.pdf", contentType: "application/pdf" } });
    expect(update).toHaveBeenCalledWith(ID.row, {
      properties: { Docs: { type: "files", files: [{ name: "Spec", url: "https://example.com/p.pdf" }, { name: "Scope.pdf", uploadId: UPLOAD }] } },
    });
  });

  it("refuses, before uploading anything, a column whose Notion-hosted files it cannot keep, unless told to replace them", async () => {
    const dir = await inbox({ "brief.pdf": PNG });
    const create = vi.fn(async () => upload("pending"));
    const update = vi.fn(async () => withDocs());
    const page = withDocs(hosted("old.pdf", "https://prod-files-secure.s3.us-west-2.amazonaws.com/a/old.pdf"), external("Site", "https://example.com"));
    const deps = crm(page, { createFileUpload: create, updatePage: update }, { readInput: inputFilesWith([dir]) });
    expect((await errorOf(() => uploadFile(deps, { page: ID.row, file: { path: "brief.pdf" }, column: "Docs", replace: false })))?.message).toContain("replace: true drops them");
    expect((await errorOf(() => uploadFile(deps, { page: ID.row, file: { path: "brief.pdf" }, column: "Status", replace: false })))?.message).toContain("not files");
    expect((await errorOf(() => uploadFile(deps, { page: ID.row, file: { path: "brief.pdf" }, replace: true })))?.message).toContain("replace goes with column");
    expect(create).not.toHaveBeenCalled();
    await uploadFile(deps, { page: ID.row, file: { path: "brief.pdf" }, column: "Docs", replace: true });
    expect(update).toHaveBeenCalledWith(ID.row, { properties: { Docs: { type: "files", files: [{ name: "Site", url: "https://example.com" }, { name: "brief.pdf", uploadId: UPLOAD }] } } });
  });

  it("stops when Notion did not take the bytes", async () => {
    const dir = await inbox({ "a.png": PNG });
    const append = vi.fn();
    const deps = crm(withDocs(), { sendFileUpload: async () => upload("failed"), appendFileBlock: append }, { readInput: inputFilesWith([dir]) });
    expect(await errorOf(() => uploadFile(deps, { page: ID.row, file: { path: "a.png" }, replace: false }))).toMatchObject({ kind: "api", message: expect.stringContaining("failed") });
    expect(append).not.toHaveBeenCalled();
  });

  it("sends Notion the upload, its bytes as multipart, and the block, on the documented paths", async () => {
    const dir = await inbox({ "chart.png": PNG });
    const raw: { url: string; init?: RequestInit }[] = [];
    const calls = withFetch((url, init) => {
      raw.push({ url, ...(init === undefined ? {} : { init }) });
      const path = new URL(url).pathname.replace("/v1/", "");
      if (path === `pages/${ID.row}`) return json(withDocs());
      if (path === "file_uploads") return json(upload("pending"));
      if (path === `file_uploads/${UPLOAD}/send`) return json(upload());
      if (path === `blocks/${ID.row}/children`) return json({ object: "list", results: [{ object: "block", id: BLOCK }], next_cursor: null, has_more: false });
      return notionError(404, "object_not_found");
    });
    const deps = buildDeps({ NOTION_TOKENS_DIR: tokensDir({ work: "ntn_work" }), MCP_FILE_ROOTS: dir }, { sleep: async () => undefined });
    await uploadFile(deps, { page: ID.row, file: { path: "chart.png" }, replace: false });
    expect(calls.find((c) => c.url.endsWith("/file_uploads"))?.body).toEqual({ mode: "single_part", filename: "chart.png", content_type: "image/png" });
    const send = raw.find((r) => r.url.endsWith("/send"));
    const type = (send?.init?.headers as Record<string, string>)["Content-Type"] ?? "";
    const boundary = /boundary=(.+)$/.exec(type)?.[1] as string;
    expect(Buffer.from(send?.init?.body as Uint8Array)).toEqual(Buffer.from(multipartFile(boundary, "chart.png", "image/png", PNG)));
    expect(calls.find((c) => c.url.endsWith("/children"))).toMatchObject({ method: "PATCH", body: { children: [{ object: "block", type: "image", image: { type: "file_upload", file_upload: { id: UPLOAD } } }] } });
  });
});

describe("download_files", () => {
  const S3 = "https://prod-files-secure.s3.us-west-2.amazonaws.com/ws";
  const page = withDocs(hosted("contract.pdf", `${S3}/1/contract.pdf?X-Amz-Signature=a`), hosted("contract.pdf", `${S3}/2/contract.pdf?X-Amz-Signature=b`), external("Site", "https://example.com/x"));
  const blocks = {
    [ID.row]: [
      { object: "block", id: TOGGLE, type: "toggle", has_children: true, toggle: { rich_text: [] } },
      { object: "block", id: "c1", type: "child_page", has_children: true, child_page: { title: "Sub" } },
      { object: "block", id: "p1", type: "pdf", has_children: false, pdf: { type: "external", external: { url: "https://example.com/a.pdf" } } },
    ],
    [TOGGLE]: [{ object: "block", id: BLOCK, type: "image", has_children: false, image: { type: "file", file: { url: `${S3}/3/photo%20one.jpg?X-Amz-Signature=c`, expiry_time: "x" } } }],
  } as Record<string, unknown[]>;
  const list = async (id: string) => ({ object: "list", results: blocks[id] ?? [], next_cursor: null, has_more: false }) as never;

  it("saves every Notion-hosted file of the columns and the body, each with its SHA-256, and lists external links", async () => {
    const outbox = await mkdtemp(join(tmpdir(), "notion-outbox-"));
    const download = vi.fn(async (url: string) => {
      if (url.includes("/2/")) return fail({ kind: "api", status: 403, message: "the file's link has expired" });
      return new TextEncoder().encode(`bytes of ${new URL(url).pathname}`);
    });
    const deps = crm(page, { listBlockChildren: list }, { outbox, download });
    const out = await downloadFiles(deps, { page: ID.row, body: true });
    const folder = join(outbox, ID.row);
    expect(out).toMatchObject({ account: "work", page: ID.row, folder });
    expect(out.saved.map((s) => [s.name, s.from])).toEqual([
      ["contract.pdf", "Docs"],
      ["photo one.jpg", `body (image block ${BLOCK})`],
    ]);
    const first = await readFile(join(folder, "contract.pdf"));
    expect(out.saved[0]).toMatchObject({ path: join(folder, "contract.pdf"), size: first.length, sha256: sha(first) });
    expect(out.failed).toEqual([{ name: "contract.pdf", from: "Docs", error: expect.stringContaining("expired") }]);
    expect(out.external).toEqual([
      { name: "Site", url: "https://example.com/x", from: "Docs" },
      { name: "a.pdf", url: "https://example.com/a.pdf", from: "body (pdf block p1)" },
    ]);
    expect(download).not.toHaveBeenCalledWith(expect.stringContaining("example.com"));
  });

  it("reads one column alone, into a folder of the caller's inside the outbox", async () => {
    const outbox = await mkdtemp(join(tmpdir(), "notion-outbox-"));
    const listBlocks = vi.fn(list);
    const deps = crm(withDocs(hosted("a.txt", `${S3}/a.txt`)), { listBlockChildren: listBlocks }, { outbox, download: async () => new Uint8Array([1]) });
    const out = await downloadFiles(deps, { page: ID.row, column: "docs", body: true, saveDir: "2026-10/acme" });
    expect(out.saved[0]?.path).toBe(join(outbox, "2026-10/acme", "a.txt"));
    expect(listBlocks).not.toHaveBeenCalled();
    expect((await errorOf(() => downloadFiles(deps, { page: ID.row, body: true, saveDir: "/etc" })))?.kind).toBe("input");
  });

  it("names the variable when there is no outbox", async () => {
    expect(await errorOf(() => downloadFiles(crm(), { page: ID.row, body: true }))).toMatchObject({ kind: "config", variable: "NOTION_OUTBOX_DIR" });
  });
});

describe("file names and bytes", () => {
  it("keeps a name to one safe file, and each name once", () => {
    expect(safeFileName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(safeFileName("..")).toBe("file");
    expect(uniqueNames(["a.pdf", "A.pdf", "a.pdf", "notes"])).toEqual(["a.pdf", "A (2).pdf", "a (3).pdf", "notes"]);
  });

  it("quotes a name so it cannot end the multipart header", () => {
    const text = Buffer.from(multipartFile("b", 'x"\r\nInjected: 1.png', "image/png", new Uint8Array())).toString();
    expect(text).toContain('filename="x%22%0D%0AInjected: 1.png"');
  });

  it("fetches a signed link without the token, refuses a non-https one, and says an expired link is one", async () => {
    const calls = withFetch((url) => (url.includes("expired") ? new Response("no", { status: 403 }) : new Response(new Uint8Array([7, 8]), { status: 200 })));
    const download = makeDownload({ maxBytes: 4 });
    expect(await download("https://files.example.com/ok")).toEqual(new Uint8Array([7, 8]));
    expect(calls[0]?.headers["Authorization"]).toBeUndefined();
    expect((await errorOf(() => download("https://files.example.com/expired")))?.message).toContain("expired");
    expect((await errorOf(() => download("http://files.example.com/ok")))?.message).toContain("not https");
    withFetch(() => new Response(new Uint8Array(10), { status: 200 }));
    expect((await errorOf(() => download("https://files.example.com/big")))?.message).toContain("over the 4 bytes");
  });
});
