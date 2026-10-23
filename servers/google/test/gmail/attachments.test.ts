import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { attachmentsOf } from "../../src/gmail/domain/attachments.js";
import { makeGmailApi } from "../../src/gmail/infra/gmailApi.js";
import { candidateNames, saveNew } from "../../src/infra/saveNew.js";

describe("attachmentsOf", () => {
  it("finds attachments nested in sub-parts", () => {
    const payload = {
      parts: [{ parts: [{ filename: "inv.pdf", mimeType: "application/pdf", body: { attachmentId: "a1", size: 1234 } }] }],
    };
    expect(attachmentsOf(payload)).toEqual([
      { filename: "inv.pdf", mimeType: "application/pdf", attachmentId: "a1", size: 1234 },
    ]);
  });

  it("does not count an inline part that merely has an attachmentId", () => {
    // Gmail hands out attachmentIds for large inline bodies too. Counting those
    // would report every newsletter as carrying an attachment.
    const payload = { parts: [{ mimeType: "text/html", filename: "", body: { attachmentId: "x", size: 90_000 } }] };
    expect(attachmentsOf(payload)).toEqual([]);
  });

  it("returns nothing for a payload with no parts", () => {
    expect(attachmentsOf({ mimeType: "text/plain" })).toEqual([]);
  });
});

describe("saving attachments", () => {
  it("keeps two different files of one name, and saves the same bytes once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "save-new-"));
    const first = await saveNew(dir, "invoice.pdf", Buffer.from("one"));
    const second = await saveNew(dir, "invoice.pdf", Buffer.from("two"));
    const again = await saveNew(dir, "invoice.pdf", Buffer.from("two"));
    expect([first, second, again]).toEqual([join(dir, "invoice.pdf"), join(dir, "invoice (2).pdf"), join(dir, "invoice (2).pdf")]);
    expect(await readFile(first, "utf8")).toBe("one");
    expect((await readdir(dir)).sort()).toEqual(["invoice (2).pdf", "invoice.pdf"]);
  });

  it("names the second of a pair without an extension too", () => {
    const names = candidateNames("README");
    expect([names.next().value, names.next().value]).toEqual(["README", "README (2)"]);
  });
});

describe("getAttachment", () => {
  const api = (body: unknown) => makeGmailApi((async () => body) as never, async () => "token");

  it("refuses an answer whose data does not decode to the size Gmail states", async () => {
    await expect(api({ data: Buffer.from("abc").toString("base64url"), size: 4 }).getAttachment("m", "a")).rejects.toMatchObject({ error: { kind: "api" } });
  });

  it("refuses an answer with no data, unless the attachment is empty", async () => {
    await expect(api({ size: 3 }).getAttachment("m", "a")).rejects.toMatchObject({ error: { kind: "api" } });
    expect((await api({ size: 0 }).getAttachment("m", "a")).length).toBe(0);
    expect((await api({ data: Buffer.from("abc").toString("base64url"), size: 3 }).getAttachment("m", "a")).toString()).toBe("abc");
  });

  it("sends every id as one path segment", async () => {
    const urls: string[] = [];
    const gmail = makeGmailApi((async (url: string) => (urls.push(url), { data: "", size: 0 })) as never, async () => "token");
    await gmail.getAttachment("m/../../drafts", "a?b");
    expect(urls[0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/m%2F..%2F..%2Fdrafts/attachments/a%3Fb");
  });
});
