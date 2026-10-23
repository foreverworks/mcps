import { randomBytes } from "node:crypto";

import type { About, ChangeBatch, DrivePort, ListOptions, Patch, SearchSpec, Upload } from "../app/ports.js";
import type { RawComment, RawPermission, RawRevision } from "../domain/schema.js";
import type { RawFile } from "../domain/entries.js";
import { apiError, fail } from "../domain/errors.js";
import { nameVariants, quoteForQuery } from "../domain/path.js";
import type { Query, Request } from "../../infra/httpJson.js";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

/**
 * The fields asked for on every file.
 *
 * Drive returns `id, name, mimeType` and nothing else unless asked, so this
 * list is the whole contract for what the tools can report. `parents` is here
 * because a move has to remove the old ones, and `md5Checksum` because it is
 * the only cheap way to tell a file apart from a copy of itself. `sha256Checksum`
 * is what an upload is checked against: Drive's own hash of what it stored.
 */
const FILE_FIELDS = "id,name,mimeType,parents,size,modifiedTime,trashed,md5Checksum,sha256Checksum,webViewLink";

/** What an upload answers with: the file, and the revision the bytes became, so a damaged one can be taken back. */
const UPLOADED_FIELDS = `${FILE_FIELDS},headRevisionId`;

const MAX_PAGE = 1000;

/** Drive answers a comment with nothing unless asked; this is what a reader of the thread needs. */
const USER = "displayName,emailAddress,me";
const REPLY_FIELDS = `id,content,action,deleted,createdTime,modifiedTime,author(${USER})`;
const COMMENT_FIELDS = `id,content,resolved,deleted,createdTime,modifiedTime,anchor,quotedFileContent,author(${USER}),replies(${REPLY_FIELDS})`;
const PERMISSION_FIELDS = "id,type,role,emailAddress,domain,displayName,expirationTime,allowFileDiscovery,deleted,pendingOwner,permissionDetails";
const REVISION_FIELDS =
  `id,mimeType,modifiedTime,keepForever,published,publishAuto,publishedOutsideDomain,publishedLink,originalFilename,md5Checksum,size,exportLinks,lastModifyingUser(${USER})`;

/** Shared drives are included everywhere; a file there is still the owner's file. */
const ALL_DRIVES = { supportsAllDrives: "true" } as const;

const and = (clauses: readonly (string | null)[]): string => clauses.filter((c): c is string => c !== null).join(" and ");

const fileUrl = (id: string): string => `${DRIVE}/files/${encodeURIComponent(id)}`;

/** Drive's multipart upload: the metadata, then the bytes, in one request. */
const multipart = (metadata: object, file: Upload, boundary: string): Buffer =>
  Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
      "utf8",
    ),
    file.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);

/** The source's modification time, when it has one to carry. */
const modified = (file: Upload): { readonly modifiedTime?: string } => (file.modifiedTime === undefined ? {} : { modifiedTime: file.modifiedTime });

/**
 * `upload` is a second request layer with a longer timeout: the bytes of a
 * large file take longer than any metadata call should be allowed to.
 */
export const makeDriveApi = (request: Request, upload: Request = request): DrivePort => {
  type Page = { readonly files?: readonly RawFile[]; readonly nextPageToken?: string };

  // Drive caps a page at 1000, so a larger limit is several round trips; each
  // one carries what the earlier pages found rather than appending to a list.
  const listFiles = async (q: string, limit: number, pageToken = "", found: readonly RawFile[] = []): Promise<readonly RawFile[]> => {
    const page = await request<Page>(`${DRIVE}/files`, {
      query: {
        q,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: Math.min(MAX_PAGE, limit - found.length),
        includeItemsFromAllDrives: "true",
        pageToken: pageToken || undefined,
        ...ALL_DRIVES,
      },
    });
    const all = [...found, ...(page.files ?? [])];
    return page.nextPageToken && all.length < limit ? listFiles(q, limit, page.nextPageToken, all) : all.slice(0, limit);
  };

  return {
    about: async (): Promise<About> => {
      const body = await request<{
        readonly user?: { readonly emailAddress?: string };
        readonly storageQuota?: { readonly usage?: string; readonly limit?: string };
      }>(`${DRIVE}/about`, { query: { fields: "user(emailAddress),storageQuota(usage,limit)" } });
      return {
        user: body.user?.emailAddress ?? "unknown",
        quotaUsedBytes: body.storageQuota?.usage === undefined ? null : Number(body.storageQuota.usage),
        quotaLimitBytes: body.storageQuota?.limit === undefined ? null : Number(body.storageQuota.limit),
      };
    },
    get: (id) => request<RawFile>(fileUrl(id), { query: { fields: FILE_FIELDS, ...ALL_DRIVES } }),
    listChildren: (parentId, options: ListOptions) =>
      listFiles(and([`${quoteForQuery(parentId)} in parents`, options.includeTrashed ? null : "trashed = false"]), options.limit),
    // Both Unicode normalisations in one query: see nameVariants for why a
    // single spelling misses every folder whose name was stored in the other
    // normalisation.
    childrenNamed: (parentId, name) =>
      listFiles(
        and([
          `${quoteForQuery(parentId)} in parents`,
          `(${nameVariants(name).map((v) => `name = ${quoteForQuery(v)}`).join(" or ")})`,
          "trashed = false",
        ]),
        MAX_PAGE,
      ),
    search: (spec: SearchSpec) =>
      listFiles(
        and([
          spec.nameContains ? `name contains ${quoteForQuery(spec.nameContains)}` : null,
          spec.fullText ? `fullText contains ${quoteForQuery(spec.fullText)}` : null,
          spec.mimeType ? `mimeType = ${quoteForQuery(spec.mimeType)}` : null,
          spec.parentId ? `${quoteForQuery(spec.parentId)} in parents` : null,
          spec.modifiedAfter ? `modifiedTime > ${quoteForQuery(spec.modifiedAfter)}` : null,
          spec.includeTrashed ? null : "trashed = false",
        ]) || "trashed = false",
        spec.limit,
      ),
    // POSTs, so not retried after a 5xx: a second attempt could make a second file.
    createFile: (name, mimeType, parentId) =>
      request<RawFile>(`${DRIVE}/files`, {
        method: "POST",
        query: { fields: FILE_FIELDS, ...ALL_DRIVES },
        json: { name, parents: [parentId], mimeType },
      }),
    copy: (id, name, parentId) =>
      request<RawFile>(`${fileUrl(id)}/copy`, {
        method: "POST",
        query: { fields: FILE_FIELDS, ...ALL_DRIVES },
        json: { name, parents: [parentId] },
      }),
    /**
     * A move IS this call. `addParents`/`removeParents` are query parameters,
     * not body fields, and Drive silently ignores them if they are put in the
     * body, which looks exactly like a move that did nothing.
     */
    update: (id, patch: Patch) => {
      const query: Query = {
        fields: FILE_FIELDS,
        addParents: patch.addParents?.length ? patch.addParents.join(",") : undefined,
        removeParents: patch.removeParents?.length ? patch.removeParents.join(",") : undefined,
        ...ALL_DRIVES,
      };
      return request<RawFile>(fileUrl(id), {
        method: "PATCH",
        query,
        json: {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.trashed === undefined ? {} : { trashed: patch.trashed }),
        },
      });
    },
    upload: (parentId, file) => {
      const boundary = `drive_${randomBytes(12).toString("hex")}`;
      // A conversion names the Google type here while the bytes keep their own: that pair is what makes Drive convert.
      const metadata = { name: file.name, parents: [parentId], mimeType: file.convertTo ?? file.mimeType, ...modified(file) };
      return upload<RawFile>(`${UPLOAD}/files`, {
        method: "POST",
        query: { uploadType: "multipart", fields: UPLOADED_FIELDS, ...ALL_DRIVES },
        body: { contentType: `multipart/related; boundary=${boundary}`, data: multipart(metadata, file, boundary) },
      });
    },
    // The same bytes sent twice make two identical revisions, which is harmless: safe to retry. With
    // a modification time to carry, the bytes and that time go together as one multipart PATCH, so a
    // revision never exists with Drive's clock on it instead of the source's.
    replaceContent: (id, file) => {
      const url = `${UPLOAD}/files/${encodeURIComponent(id)}`;
      if (file.modifiedTime === undefined) {
        return upload<RawFile>(url, { method: "PATCH", query: { uploadType: "media", fields: UPLOADED_FIELDS, ...ALL_DRIVES }, body: { contentType: file.mimeType, data: file.bytes } });
      }
      const boundary = `drive_${randomBytes(12).toString("hex")}`;
      return upload<RawFile>(url, {
        method: "PATCH",
        query: { uploadType: "multipart", fields: UPLOADED_FIELDS, ...ALL_DRIVES },
        body: { contentType: `multipart/related; boundary=${boundary}`, data: multipart(modified(file), file, boundary) },
      });
    },
    deleteRevision: async (id, revisionId) => {
      await request<void>(`${fileUrl(id)}/revisions/${encodeURIComponent(revisionId)}`, { method: "DELETE", idempotent: true });
    },
    // Export returns the document itself, not JSON.
    exportText: (id, exportMime) => request<string>(`${fileUrl(id)}/export`, { query: { mimeType: exportMime }, as: "text" }),
    // Bytes on the long-timeout layer: a large file takes as long to come down as to go up.
    download: (id) => upload<Uint8Array>(fileUrl(id), { query: { alt: "media", ...ALL_DRIVES }, as: "bytes" }),
    exportBytes: (id, exportMime) => upload<Uint8Array>(`${fileUrl(id)}/export`, { query: { mimeType: exportMime }, as: "bytes" }),
    listComments: async (fileId, options) => {
      type CommentPage = { readonly comments?: readonly RawComment[]; readonly nextPageToken?: string };
      const walk = async (pageToken: string, found: readonly RawComment[]): Promise<readonly RawComment[]> => {
        const page = await request<CommentPage>(`${fileUrl(fileId)}/comments`, {
          query: {
            fields: `nextPageToken,comments(${COMMENT_FIELDS})`,
            pageSize: 100,
            includeDeleted: options.includeDeleted ? "true" : undefined,
            startModifiedTime: options.modifiedAfter || undefined,
            pageToken: pageToken || undefined,
          },
        });
        const all = [...found, ...(page.comments ?? [])];
        return page.nextPageToken && all.length < options.limit ? walk(page.nextPageToken, all) : all.slice(0, options.limit);
      };
      return walk("", []);
    },
    createComment: (fileId, comment) =>
      request<RawComment>(`${fileUrl(fileId)}/comments`, {
        method: "POST",
        query: { fields: COMMENT_FIELDS },
        json: {
          content: comment.content,
          ...(comment.quoted ? { quotedFileContent: { mimeType: "text/plain", value: comment.quoted } } : {}),
          ...(comment.anchor ? { anchor: comment.anchor } : {}),
        },
      }),
    updateComment: (fileId, commentId, content) =>
      request<RawComment>(`${fileUrl(fileId)}/comments/${encodeURIComponent(commentId)}`, { method: "PATCH", query: { fields: COMMENT_FIELDS }, json: { content } }),
    deleteComment: async (fileId, commentId) => {
      await request<void>(`${fileUrl(fileId)}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
    },
    createReply: (fileId, commentId, reply) =>
      request(`${fileUrl(fileId)}/comments/${encodeURIComponent(commentId)}/replies`, {
        method: "POST",
        query: { fields: REPLY_FIELDS },
        json: { ...(reply.content ? { content: reply.content } : {}), ...(reply.action ? { action: reply.action } : {}) },
      }),
    updateReply: (fileId, commentId, replyId, content) =>
      request(`${fileUrl(fileId)}/comments/${encodeURIComponent(commentId)}/replies/${encodeURIComponent(replyId)}`, {
        method: "PATCH",
        query: { fields: REPLY_FIELDS },
        json: { content },
      }),
    deleteReply: async (fileId, commentId, replyId) => {
      await request<void>(`${fileUrl(fileId)}/comments/${encodeURIComponent(commentId)}/replies/${encodeURIComponent(replyId)}`, { method: "DELETE" });
    },
    listPermissions: async (fileId) => {
      type PermissionPage = { readonly permissions?: readonly RawPermission[]; readonly nextPageToken?: string };
      const walk = async (pageToken: string, found: readonly RawPermission[]): Promise<readonly RawPermission[]> => {
        const page = await request<PermissionPage>(`${fileUrl(fileId)}/permissions`, {
          query: { fields: `nextPageToken,permissions(${PERMISSION_FIELDS})`, pageSize: 100, pageToken: pageToken || undefined, ...ALL_DRIVES },
        });
        const all = [...found, ...(page.permissions ?? [])];
        return page.nextPageToken ? walk(page.nextPageToken, all) : all;
      };
      return walk("", []);
    },
    createPermission: (fileId, permission, options) =>
      request<RawPermission>(`${fileUrl(fileId)}/permissions`, {
        method: "POST",
        query: {
          fields: PERMISSION_FIELDS,
          sendNotificationEmail: permission.type === "user" || permission.type === "group" ? String(options.notify) : undefined,
          emailMessage: options.notify && options.message ? options.message : undefined,
          transferOwnership: options.transferOwnership ? "true" : undefined,
          ...ALL_DRIVES,
        },
        json: permission,
      }),
    updatePermission: (fileId, permissionId, patch) =>
      request<RawPermission>(`${fileUrl(fileId)}/permissions/${encodeURIComponent(permissionId)}`, {
        method: "PATCH",
        query: {
          fields: PERMISSION_FIELDS,
          transferOwnership: patch.transferOwnership ? "true" : undefined,
          removeExpiration: patch.removeExpiration ? "true" : undefined,
          ...ALL_DRIVES,
        },
        json: { ...(patch.role ? { role: patch.role } : {}), ...(patch.expirationTime ? { expirationTime: patch.expirationTime } : {}) },
      }),
    deletePermission: async (fileId, permissionId) => {
      await request<void>(`${fileUrl(fileId)}/permissions/${encodeURIComponent(permissionId)}`, { method: "DELETE", query: ALL_DRIVES });
    },
    listRevisions: async (fileId) => {
      type RevisionPage = { readonly revisions?: readonly RawRevision[]; readonly nextPageToken?: string };
      const walk = async (pageToken: string, found: readonly RawRevision[]): Promise<readonly RawRevision[]> => {
        const page = await request<RevisionPage>(`${fileUrl(fileId)}/revisions`, {
          query: { fields: `nextPageToken,revisions(${REVISION_FIELDS})`, pageSize: 200, pageToken: pageToken || undefined },
        });
        const all = [...found, ...(page.revisions ?? [])];
        return page.nextPageToken ? walk(page.nextPageToken, all) : all;
      };
      return walk("", []);
    },
    updateRevision: (fileId, revisionId, patch) =>
      request<RawRevision>(`${fileUrl(fileId)}/revisions/${encodeURIComponent(revisionId)}`, { method: "PATCH", query: { fields: REVISION_FIELDS }, json: patch }),
    downloadRevision: (fileId, revisionId) =>
      upload<Uint8Array>(`${fileUrl(fileId)}/revisions/${encodeURIComponent(revisionId)}`, { query: { alt: "media" }, as: "bytes" }),
    exportRevision: (exportLink) => upload<Uint8Array>(exportLink, { as: "bytes" }),
    startPageToken: async () =>
      (await request<{ readonly startPageToken?: string }>(`${DRIVE}/changes/startPageToken`, { query: ALL_DRIVES })).startPageToken ??
      fail(apiError(0, "Drive returned no startPageToken")),
    changes: async (pageToken, limit): Promise<ChangeBatch> => {
      const body = await request<ChangeBatch>(`${DRIVE}/changes`, {
        query: {
          pageToken,
          pageSize: Math.min(MAX_PAGE, limit),
          fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
          includeItemsFromAllDrives: "true",
          ...ALL_DRIVES,
        },
      });
      return {
        changes: body.changes ?? [],
        ...(body.nextPageToken === undefined ? {} : { nextPageToken: body.nextPageToken }),
        ...(body.newStartPageToken === undefined ? {} : { newStartPageToken: body.newStartPageToken }),
      };
    },
  };
};
