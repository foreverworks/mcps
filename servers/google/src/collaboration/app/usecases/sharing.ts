import { shape } from "../../../drive/domain/entries.js";
import { fileIdFrom } from "../../../editors/domain/ids.js";
import { fail, inputError } from "../../domain/errors.js";
import { permissionView } from "../../domain/view.js";
import type { Deps } from "../ports.js";

/** Who has access to a file and how, with the file named, so a share is read before it is changed. */
export const listPermissions = async (deps: Deps, args: { readonly fileId: string }) => {
  const id = fileIdFrom(args.fileId);
  const [file, permissions] = await Promise.all([deps.drive.drive.get(id), deps.drive.drive.listPermissions(id)]);
  const views = permissions.map(permissionView);
  const anyone = views.find((p) => p.type === "anyone");
  return {
    fileId: id,
    name: shape(file).name,
    link: shape(file).link,
    linkSharing: anyone ? `anyone with the link: ${anyone.role}` : "restricted",
    permissions: views,
  };
};

export type ShareArgs = {
  readonly fileId: string;
  readonly type: "user" | "group" | "domain" | "anyone";
  readonly role: string;
  readonly emailAddress: string;
  readonly domain: string;
  readonly discoverable: boolean;
  readonly expirationTime: string;
  readonly notify: boolean;
  readonly message: string;
  readonly transferOwnership: boolean;
};

/**
 * Access for a person, a group, a domain or anyone with the link. Checked
 * here first for what Drive would refuse less clearly: who a type needs, and
 * that making someone the owner is said in so many words.
 */
export const shareFile = async (deps: Deps, args: ShareArgs) => {
  const needsEmail = args.type === "user" || args.type === "group";
  if (needsEmail && !args.emailAddress.trim()) return fail(inputError(`a ${args.type} share needs email_address`));
  if (args.type === "domain" && !args.domain.trim()) return fail(inputError("a domain share needs domain"));
  if (!needsEmail && args.emailAddress.trim()) return fail(inputError(`email_address is for user and group shares, not ${args.type}`));
  if (args.role === "owner" && !args.transferOwnership) return fail(inputError("making someone the owner gives the file away: pass transfer_ownership: true if that is meant"));
  if (args.message && !args.notify) return fail(inputError("message is the text of Drive's email, which notify: false does not send"));
  const id = fileIdFrom(args.fileId);
  const made = await deps.drive.drive.createPermission(
    id,
    {
      type: args.type,
      role: args.role,
      ...(needsEmail ? { emailAddress: args.emailAddress.trim() } : {}),
      ...(args.type === "domain" ? { domain: args.domain.trim() } : {}),
      ...(args.type === "domain" || args.type === "anyone" ? { allowFileDiscovery: args.discoverable } : {}),
      ...(args.expirationTime ? { expirationTime: args.expirationTime } : {}),
    },
    { notify: args.notify, ...(args.message ? { message: args.message } : {}), ...(args.transferOwnership ? { transferOwnership: true } : {}) },
  );
  return { fileId: id, notified: needsEmail && args.notify, ...permissionView(made) };
};

export const updatePermission = async (
  deps: Deps,
  args: { readonly fileId: string; readonly permissionId: string; readonly role: string; readonly expirationTime: string; readonly removeExpiration: boolean; readonly transferOwnership: boolean },
) => {
  if (!args.role && !args.expirationTime && !args.removeExpiration) return fail(inputError("give role, expiration_time or remove_expiration: nothing would change"));
  if (args.expirationTime && args.removeExpiration) return fail(inputError("expiration_time and remove_expiration contradict each other"));
  if (args.role === "owner" && !args.transferOwnership) return fail(inputError("making someone the owner gives the file away: pass transfer_ownership: true if that is meant"));
  const id = fileIdFrom(args.fileId);
  const updated = await deps.drive.drive.updatePermission(id, args.permissionId, {
    ...(args.role ? { role: args.role } : {}),
    ...(args.expirationTime ? { expirationTime: args.expirationTime } : {}),
    ...(args.removeExpiration ? { removeExpiration: true } : {}),
    ...(args.transferOwnership ? { transferOwnership: true } : {}),
  });
  return { fileId: id, ...permissionView(updated) };
};

/** One permission removed: the person, group, domain or link loses that access. */
export const removePermission = async (deps: Deps, args: { readonly fileId: string; readonly permissionId: string }) => {
  const id = fileIdFrom(args.fileId);
  await deps.drive.drive.deletePermission(id, args.permissionId);
  return { fileId: id, permissionId: args.permissionId, removed: true };
};
