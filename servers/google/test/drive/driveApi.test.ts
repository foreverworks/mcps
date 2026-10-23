/** The upload requests, as Drive must receive them: no network, a recording request layer. */
import { describe, expect, it } from "vitest";

import { makeDriveApi } from "../../src/drive/infra/driveApi.js";
import type { Request, RequestSpec } from "../../src/infra/httpJson.js";

const recording = () => {
  const calls: { url: string; spec: RequestSpec }[] = [];
  const request = (async (url: string, spec: RequestSpec = {}) => {
    calls.push({ url, spec });
    return { id: "f1" };
  }) as unknown as Request;
  return { calls, request };
};

describe("Drive uploads, on the wire", () => {
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x0d, 0x0a]);

  it("sends a new file as one multipart request to the upload endpoint, the bytes untouched", async () => {
    const { calls, request } = recording();
    const metadataOnly = recording();
    await makeDriveApi(metadataOnly.request, request).upload("acc", { name: "a.zip", mimeType: "application/zip", bytes });
    expect(metadataOnly.calls).toEqual([]);
    const [{ url, spec }] = calls as [{ url: string; spec: RequestSpec }];
    expect(url).toBe("https://www.googleapis.com/upload/drive/v3/files");
    expect(spec).toMatchObject({ method: "POST", query: { uploadType: "multipart", fields: expect.stringContaining("sha256Checksum") } });
    const boundary = /boundary=(\S+)/.exec(spec.body?.contentType ?? "")?.[1] as string;
    const body = Buffer.from(spec.body?.data as Uint8Array);
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.zip","parents":["acc"],"mimeType":"application/zip"}\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`;
    expect(body.equals(Buffer.concat([Buffer.from(head), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]))).toBe(true);
  });

  it("converts by naming the Google type in the metadata while the bytes keep their own", async () => {
    const { calls, request } = recording();
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    await makeDriveApi(request).upload("rep", { name: "Q3 report", mimeType: docx, bytes, convertTo: "application/vnd.google-apps.document" });
    const spec = calls[0]?.spec as RequestSpec;
    const body = Buffer.from(spec.body?.data as Uint8Array).toString("latin1");
    expect(body).toContain('{"name":"Q3 report","parents":["rep"],"mimeType":"application/vnd.google-apps.document"}');
    expect(body).toContain(`Content-Type: ${docx}\r\n\r\n`);
  });

  it("gives an existing file new bytes as a media PATCH, the same id", async () => {
    const { calls, request } = recording();
    await makeDriveApi(request).replaceContent("z/1", { name: "a.zip", mimeType: "application/zip", bytes });
    expect(calls[0]?.url).toBe("https://www.googleapis.com/upload/drive/v3/files/z%2F1");
    expect(calls[0]?.spec).toMatchObject({ method: "PATCH", query: { uploadType: "media" }, body: { contentType: "application/zip", data: bytes } });
  });
});

describe("Drive keeps the source's modification time, and hands bytes back", () => {
  const bytes = Buffer.from("%PDF-1.7\n");
  const modifiedTime = "2026-01-01T12:00:00.123Z";
  const metadataOf = (spec: RequestSpec): unknown => {
    const body = Buffer.from(spec.body?.data as Uint8Array).toString("latin1");
    return JSON.parse(/\r\n\r\n(\{.*?\})\r\n/s.exec(body)?.[1] ?? "null");
  };

  it("puts the time in a new file's metadata", async () => {
    const { calls, request } = recording();
    await makeDriveApi(request).upload("brand", { name: "logo.pdf", mimeType: "application/pdf", bytes, modifiedTime });
    expect(metadataOf(calls[0]?.spec ?? {})).toEqual({ name: "logo.pdf", parents: ["brand"], mimeType: "application/pdf", modifiedTime });
  });

  it("sends new bytes and their time together as one multipart PATCH", async () => {
    const { calls, request } = recording();
    await makeDriveApi(request).replaceContent("logo", { name: "logo.pdf", mimeType: "application/pdf", bytes, modifiedTime });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://www.googleapis.com/upload/drive/v3/files/logo");
    expect(calls[0]?.spec).toMatchObject({ method: "PATCH", query: { uploadType: "multipart" } });
    expect(metadataOf(calls[0]?.spec ?? {})).toEqual({ modifiedTime });
    expect(Buffer.from(calls[0]?.spec.body?.data as Uint8Array).includes(bytes)).toBe(true);
  });

  it("downloads a file's own bytes, and exports a Google file, both on the long-timeout layer as bytes", async () => {
    const metadataOnly = recording();
    const { calls, request } = recording();
    const api = makeDriveApi(metadataOnly.request, request);
    await api.download("a/b");
    await api.exportBytes("doc", "application/pdf");
    expect(metadataOnly.calls).toEqual([]);
    expect(calls[0]).toMatchObject({ url: "https://www.googleapis.com/drive/v3/files/a%2Fb", spec: { query: { alt: "media" }, as: "bytes" } });
    expect(calls[1]).toMatchObject({ url: "https://www.googleapis.com/drive/v3/files/doc/export", spec: { query: { mimeType: "application/pdf" }, as: "bytes" } });
  });
});
