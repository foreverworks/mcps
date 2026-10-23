import type { RawComment, RawPermission, RawReply, RawRevision } from "../../drive/domain/schema.js";

/**
 * Drive's comments, permissions and revisions as a model reads them: ids it
 * can act on, who and when, nothing empty. Pure.
 */

type User = { readonly displayName?: string | null; readonly emailAddress?: string | null; readonly me?: boolean | null } | null | undefined;

const with_ = <K extends string>(key: K, value: unknown): Partial<Record<K, unknown>> =>
  value === undefined || value === null || value === "" || value === false ? {} : ({ [key]: value } as Record<K, unknown>);

/** Who, as Drive tells it: an address only for people the account can see it for. */
const person = (user: User) =>
  user ? { ...with_("name", user.displayName), ...with_("email", user.emailAddress), ...(user.me ? { me: true } : {}) } : undefined;

export const replyView = (r: RawReply) => ({
  replyId: r.id ?? "",
  ...with_("author", person(r.author)),
  ...with_("created", r.createdTime),
  ...(r.modifiedTime && r.modifiedTime !== r.createdTime ? { modified: r.modifiedTime } : {}),
  ...with_("content", r.content),
  ...with_("action", r.action),
  ...with_("deleted", r.deleted),
});

export const commentView = (c: RawComment) => ({
  commentId: c.id ?? "",
  ...with_("author", person(c.author)),
  ...with_("created", c.createdTime),
  ...(c.modifiedTime && c.modifiedTime !== c.createdTime ? { modified: c.modifiedTime } : {}),
  ...with_("content", c.content),
  ...with_("resolved", c.resolved),
  ...with_("deleted", c.deleted),
  ...with_("quoted", c.quotedFileContent?.value),
  ...with_("anchor", c.anchor),
  replies: (c.replies ?? []).map(replyView),
});

export const permissionView = (p: RawPermission) => ({
  permissionId: p.id ?? "",
  type: p.type ?? "",
  role: p.role ?? "",
  ...with_("email", p.emailAddress),
  ...with_("domain", p.domain),
  ...with_("name", p.displayName),
  ...with_("expires", p.expirationTime),
  ...with_("discoverable", p.allowFileDiscovery),
  ...with_("pendingOwner", p.pendingOwner),
  ...with_("deleted", p.deleted),
  // Shared-drive members hold their access through the drive, not this file: removing them here fails.
  ...((p.permissionDetails ?? []).some((d) => d.inherited) ? { inherited: true } : {}),
});

export const revisionView = (r: RawRevision, formats: readonly string[]) => ({
  revisionId: r.id ?? "",
  ...with_("modified", r.modifiedTime),
  ...with_("by", person(r.lastModifyingUser)),
  ...with_("keepForever", r.keepForever),
  ...with_("published", r.published),
  ...with_("publishedLink", r.publishedLink),
  ...with_("originalFilename", r.originalFilename),
  ...with_("size", r.size === undefined || r.size === null ? undefined : Number(r.size)),
  ...with_("md5", r.md5Checksum),
  ...(formats.length > 0 ? { formats } : {}),
});
