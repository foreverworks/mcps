/**
 * Comments, sharing and revisions on any Drive file: the use cases over a fake
 * Drive port, and the adapter's requests as they go on the wire.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Deps } from "../../src/collaboration/app/ports.js";
import { addComment, deleteComment, editComment, listComments, replyToComment } from "../../src/collaboration/app/usecases/comments.js";
import { downloadRevision, listRevisions, updateRevision } from "../../src/collaboration/app/usecases/revisions.js";
import { listPermissions, removePermission, shareFile, updatePermission } from "../../src/collaboration/app/usecases/sharing.js";
import { apiError, asAppError, remedyFor } from "../../src/collaboration/domain/errors.js";
import type { Deps as DriveDeps, DrivePort } from "../../src/drive/app/ports.js";
import { makeDriveApi } from "../../src/drive/infra/driveApi.js";
import { makeRequest } from "../../src/infra/httpJson.js";

const failureOf = async (p: Promise<unknown>) => asAppError(await p.then(() => undefined, (e: unknown) => e));

const DOC = "application/vnd.google-apps.document";

const fakes = (file: { mimeType: string; name?: string } = { mimeType: DOC }) => {
  const calls: { method: string; args: unknown[] }[] = [];
  const answers: Partial<Record<keyof DrivePort, unknown>> = {
    get: { id: "F1", name: file.name ?? "Plan", mimeType: file.mimeType, webViewLink: "https://docs.google.com/document/d/F1/edit" },
    listComments: [
      { id: "c1", content: "Fix this", resolved: false, author: { displayName: "Ana Popescu", emailAddress: "ana@example.com" }, createdTime: "t1", modifiedTime: "t1", quotedFileContent: { value: "old" }, replies: [] },
      { id: "c2", content: "Done?", resolved: true, author: { displayName: "Me", me: true }, createdTime: "t2", modifiedTime: "t3", replies: [{ id: "r1", action: "resolve", createdTime: "t3" }] },
    ],
    createComment: { id: "c3", content: "New", createdTime: "t4", modifiedTime: "t4" },
    createReply: { id: "r2", content: "ok", action: "resolve", createdTime: "t5" },
    updateComment: { id: "c1", content: "Fixed", createdTime: "t1", modifiedTime: "t6" },
    updateReply: { id: "r1", content: "edited" },
    listPermissions: [
      { id: "p1", type: "user", role: "owner", emailAddress: "me@example.com" },
      { id: "anyoneWithLink", type: "anyone", role: "reader", allowFileDiscovery: false },
      { id: "p3", type: "user", role: "writer", emailAddress: "team@example.com", permissionDetails: [{ inherited: true }] },
    ],
    createPermission: { id: "p9", type: "user", role: "commenter", emailAddress: "ana@example.com" },
    updatePermission: { id: "p9", type: "user", role: "writer", emailAddress: "ana@example.com", expirationTime: "2026-12-01T00:00:00Z" },
    listRevisions: [
      { id: "1", modifiedTime: "t1", lastModifyingUser: { displayName: "Ana" }, exportLinks: { "application/pdf": "https://docs.google.com/x?format=pdf", "text/plain": "https://docs.google.com/x?format=txt" } },
      { id: "7", modifiedTime: "t9", md5Checksum: "900150983cd24fb0d6963f7d28e17f72", size: "3", originalFilename: "abc.txt" },
    ],
    updateRevision: { id: "7", keepForever: true },
    downloadRevision: Buffer.from("abc"),
    exportRevision: Buffer.from("%PDF"),
  };
  const drive = new Proxy({} as DrivePort, {
    get: (_, method: string) => async (...args: unknown[]) => {
      calls.push({ method, args });
      return answers[method as keyof DrivePort];
    },
  });
  const saved: { dir: string; name: string; bytes: Uint8Array }[] = [];
  const deps: Deps = {
    account: "work",
    drive: {
      drive,
      grant: () => ({ source: "fake", detail: "" }),
      downloads: { dir: "/outbox", save: async (dir: string, name: string, bytes: Uint8Array) => (saved.push({ dir, name, bytes }), `${dir}/${name}`) },
    } as unknown as DriveDeps,
  };
  return { deps, calls, saved };
};

describe("comments", () => {
  it("lists threads with replies, counting open and resolved, and leaves resolved out when asked", async () => {
    const { deps } = fakes();
    const all = await listComments(deps, { fileId: "https://docs.google.com/document/d/F1/edit", includeResolved: true, includeDeleted: false, modifiedAfter: "", limit: 50 });
    expect(all).toMatchObject({ fileId: "F1", open: 1, resolved: 1 });
    expect(all.comments[0]).toEqual({ commentId: "c1", author: { name: "Ana Popescu", email: "ana@example.com" }, created: "t1", content: "Fix this", quoted: "old", replies: [] });
    expect(all.comments[1]).toMatchObject({ commentId: "c2", resolved: true, modified: "t3", author: { me: true }, replies: [{ replyId: "r1", action: "resolve" }] });
    const open = await listComments(deps, { fileId: "F1", includeResolved: false, includeDeleted: false, modifiedAfter: "", limit: 50 });
    expect(open.comments.map((c) => c.commentId)).toEqual(["c1"]);
  });

  it("adds, replies, resolves, edits and deletes, refusing an empty reply", async () => {
    const { deps, calls } = fakes();
    await addComment(deps, { fileId: "F1", content: "New", quoted: "the old line", anchor: "" });
    expect(await replyToComment(deps, { fileId: "F1", commentId: "c1", content: "ok", action: "resolve" })).toMatchObject({ commentId: "c1", replyId: "r2", action: "resolve" });
    expect(await failureOf(replyToComment(deps, { fileId: "F1", commentId: "c1", content: " ", action: "" }))).toMatchObject({ kind: "input" });
    await editComment(deps, { fileId: "F1", commentId: "c1", replyId: "", content: "Fixed" });
    await editComment(deps, { fileId: "F1", commentId: "c2", replyId: "r1", content: "edited" });
    expect(await deleteComment(deps, { fileId: "F1", commentId: "c2", replyId: "r1" })).toEqual({ fileId: "F1", commentId: "c2", replyId: "r1", deleted: true });
    await deleteComment(deps, { fileId: "F1", commentId: "c1", replyId: "" });
    expect(calls.map((c) => [c.method, ...c.args])).toEqual([
      ["createComment", "F1", { content: "New", quoted: "the old line" }],
      ["createReply", "F1", "c1", { content: "ok", action: "resolve" }],
      ["updateComment", "F1", "c1", "Fixed"],
      ["updateReply", "F1", "c2", "r1", "edited"],
      ["deleteReply", "F1", "c2", "r1"],
      ["deleteComment", "F1", "c1"],
    ]);
  });
});

describe("sharing", () => {
  it("lists who has access, the link sharing in a line, and what a shared drive grants", async () => {
    const { deps } = fakes();
    const listed = await listPermissions(deps, { fileId: "F1" });
    expect(listed).toMatchObject({ name: "Plan", linkSharing: "anyone with the link: reader" });
    expect(listed.permissions[2]).toEqual({ permissionId: "p3", type: "user", role: "writer", email: "team@example.com", inherited: true });
  });

  const share = { fileId: "F1", type: "user" as const, role: "commenter", emailAddress: "ana@example.com", domain: "", discoverable: false, expirationTime: "", notify: false, message: "", transferOwnership: false };

  it("shares quietly by default, and checks what a type needs before Drive is asked", async () => {
    const { deps, calls } = fakes();
    expect(await shareFile(deps, share)).toMatchObject({ permissionId: "p9", notified: false, role: "commenter" });
    expect(calls.at(-1)?.args).toEqual(["F1", { type: "user", role: "commenter", emailAddress: "ana@example.com" }, { notify: false }]);
    await shareFile(deps, { ...share, type: "anyone", emailAddress: "", role: "reader" });
    expect(calls.at(-1)?.args[1]).toEqual({ type: "anyone", role: "reader", allowFileDiscovery: false });
    for (const wrong of [
      { ...share, emailAddress: "" },
      { ...share, type: "domain" as const, emailAddress: "" },
      { ...share, type: "anyone" as const },
      { ...share, role: "owner" },
      { ...share, message: "hi" },
    ]) {
      expect(await failureOf(shareFile(deps, wrong))).toMatchObject({ kind: "input" });
    }
    expect(calls.filter((c) => c.method === "createPermission")).toHaveLength(2);
  });

  it("changes a role or expiry, refuses a change that changes nothing, and removes access", async () => {
    const { deps, calls } = fakes();
    await updatePermission(deps, { fileId: "F1", permissionId: "p9", role: "writer", expirationTime: "2026-12-01T00:00:00Z", removeExpiration: false, transferOwnership: false });
    expect(calls.at(-1)?.args).toEqual(["F1", "p9", { role: "writer", expirationTime: "2026-12-01T00:00:00Z" }]);
    expect(await failureOf(updatePermission(deps, { fileId: "F1", permissionId: "p9", role: "", expirationTime: "", removeExpiration: false, transferOwnership: false }))).toMatchObject({ kind: "input" });
    expect(await removePermission(deps, { fileId: "F1", permissionId: "p9" })).toEqual({ fileId: "F1", permissionId: "p9", removed: true });
  });
});

describe("revisions", () => {
  it("lists a Google file's revisions with the formats each can be saved as", async () => {
    const { deps } = fakes();
    const listed = await listRevisions(deps, { fileId: "F1" });
    expect(listed.revisions[0]).toEqual({ revisionId: "1", modified: "t1", by: { name: "Ana" }, formats: ["pdf", "txt"] });
  });

  it("exports an old revision of a Google file from its link, and refuses a format it does not offer", async () => {
    const { deps, saved, calls } = fakes();
    const done = await downloadRevision(deps, { fileId: "F1", revisionId: "1", format: "", saveDir: "", filename: "" });
    expect(done).toMatchObject({ path: "/outbox/Plan (revision 1).pdf", exportedAs: "pdf", size: 4 });
    expect(calls.find((c) => c.method === "exportRevision")?.args).toEqual(["https://docs.google.com/x?format=pdf"]);
    expect(saved).toHaveLength(1);
    expect(await failureOf(downloadRevision(deps, { fileId: "F1", revisionId: "1", format: "docx", saveDir: "", filename: "" }))).toMatchObject({
      kind: "input",
      message: expect.stringContaining("offers pdf, txt"),
    });
    expect(await failureOf(downloadRevision(deps, { fileId: "F1", revisionId: "404", format: "", saveDir: "", filename: "" }))).toMatchObject({ kind: "not_found" });
  });

  it("downloads a file's revision checked against its MD5, and keeps one forever", async () => {
    const { deps } = fakes({ mimeType: "text/plain", name: "abc.txt" });
    expect(await downloadRevision(deps, { fileId: "F1", revisionId: "7", format: "", saveDir: "", filename: "" })).toMatchObject({
      path: "/outbox/abc.txt",
      md5: "900150983cd24fb0d6963f7d28e17f72",
      verifiedBy: "md5",
    });
    expect(await updateRevision(deps, { fileId: "F1", revisionId: "7", keepForever: true })).toMatchObject({ revisionId: "7", keepForever: true });
    expect(await failureOf(updateRevision(deps, { fileId: "F1", revisionId: "7" }))).toMatchObject({ kind: "input" });
  });
});

describe("on the wire", () => {
  const sent: { url: string; method: string; body: unknown }[] = [];
  const answer = (body: unknown) => {
    vi.stubGlobal("fetch", async (url: string, init: { method: string; body?: string }) => {
      sent.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
  };
  const drive = () => makeDriveApi(makeRequest({ get: async () => "token", force: async () => "token" }, { sleep: async () => undefined }));
  afterEach(() => {
    sent.length = 0;
    vi.unstubAllGlobals();
  });

  it("asks for comment fields (Drive answers none otherwise) and posts a quote as plain text", async () => {
    answer({ comments: [] });
    await drive().listComments("F 1", { includeDeleted: false, limit: 10 });
    const url = new URL(sent[0]?.url ?? "");
    expect(url.pathname).toBe("/drive/v3/files/F%201/comments");
    expect(url.searchParams.get("fields")).toContain("replies(");
    answer({ id: "c" });
    await drive().createComment("F1", { content: "x", quoted: "q" });
    expect(sent[1]).toMatchObject({ method: "POST", body: { content: "x", quotedFileContent: { mimeType: "text/plain", value: "q" } } });
  });

  it("sends Drive's email only when asked, and only for a person or group", async () => {
    answer({ id: "p" });
    await drive().createPermission("F1", { type: "user", role: "reader", emailAddress: "a@example.com" }, { notify: false });
    await drive().createPermission("F1", { type: "anyone", role: "reader" }, { notify: false });
    const first = new URL(sent[0]?.url ?? "");
    const second = new URL(sent[1]?.url ?? "");
    expect([first.searchParams.get("sendNotificationEmail"), second.searchParams.get("sendNotificationEmail")]).toEqual(["false", null]);
    expect(first.searchParams.get("supportsAllDrives")).toBe("true");
  });
});

describe("remedies", () => {
  it("names the egress allowlist when the deployment refused the host, and says retry only when Google was down", () => {
    expect(remedyFor(apiError(0, "Google Drive unreachable on GET https://docs.google.com/x: egress to docs.google.com is not allowed for this server (MCP_EGRESS_ALLOW)"))).toMatch(/MCP_EGRESS_ALLOW/);
    expect(remedyFor(apiError(0, "Google Drive unreachable: ECONNRESET"))).toBe("Google was unreachable; retry later");
  });
});
