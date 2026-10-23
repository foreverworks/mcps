import { z } from "zod";

import { fileIdArg, readAccountArg, writeAccountArg } from "../../../editors/mcp/args.js";
import type { Registrar } from "../../../editors/mcp/registrar.js";
import { listPermissions, removePermission, shareFile, updatePermission } from "../../app/usecases/sharing.js";
import type { Registry } from "../../composition.js";
import { handled } from "../envelope.js";

const ROLES = ["reader", "commenter", "writer", "fileOrganizer", "organizer", "owner"] as const;
const permissionIdArg = () => z.string().min(1).describe("The permission's id, from list_permissions.");
const OUTWARD = "It changes who can open the file: do it only on the user's explicit go for this file and these people.";

/** Who can open a file, and changing it. */
export const registerSharing: Registrar<Registry> = (server, registry) => {
  server.registerTool(
    "list_permissions",
    {
      title: "Who has access to a file",
      description:
        "Every permission on a Drive file: each person, group, domain or link with its role, expiry and id, whether it comes " +
        "from a shared drive, and the link sharing in one line. Read it before share_file, update_permission or remove_permission.",
      inputSchema: { account: readAccountArg(), file_id: fileIdArg("file") },
    },
    handled((args: { account: string; file_id: string }) => listPermissions(registry.get(args.account), { fileId: args.file_id })),
  );

  server.registerTool(
    "share_file",
    {
      title: "Share a file",
      description:
        "Give a person or group (email_address), a domain, or anyone with the link access to a Drive file, as reader, commenter, " +
        "writer (organizer roles on shared drives), with an optional expiry. Drive's email goes out only with notify: true, with " +
        "`message` in it. Making someone the owner needs transfer_ownership: true. " +
        OUTWARD,
      inputSchema: {
        account: writeAccountArg(),
        file_id: fileIdArg("file"),
        type: z.enum(["user", "group", "domain", "anyone"]),
        role: z.enum(ROLES),
        email_address: z.string().default("").describe("For user and group."),
        domain: z.string().default("").describe("For domain, e.g. example.com."),
        discoverable: z.boolean().default(false).describe("For domain and anyone: whether it shows up in search, rather than by link only."),
        expiration_time: z.string().default("").describe("RFC 3339: when the access ends."),
        notify: z.boolean().default(false).describe("Send Drive's email to the person or group."),
        message: z.string().default("").describe("The email's text, with notify."),
        transfer_ownership: z.boolean().default(false),
      },
    },
    handled(
      (args: {
        account: string;
        file_id: string;
        type: "user" | "group" | "domain" | "anyone";
        role: string;
        email_address: string;
        domain: string;
        discoverable: boolean;
        expiration_time: string;
        notify: boolean;
        message: string;
        transfer_ownership: boolean;
      }) =>
        shareFile(registry.get(args.account), {
          fileId: args.file_id,
          type: args.type,
          role: args.role,
          emailAddress: args.email_address,
          domain: args.domain,
          discoverable: args.discoverable,
          expirationTime: args.expiration_time,
          notify: args.notify,
          message: args.message,
          transferOwnership: args.transfer_ownership,
        }),
    ),
  );

  server.registerTool(
    "update_permission",
    {
      title: "Change someone's access",
      description: `A permission's role or expiry (or its expiry removed). Making someone the owner needs transfer_ownership: true. ${OUTWARD}`,
      inputSchema: {
        account: writeAccountArg(),
        file_id: fileIdArg("file"),
        permission_id: permissionIdArg(),
        role: z.enum(["", ...ROLES]).default(""),
        expiration_time: z.string().default(""),
        remove_expiration: z.boolean().default(false),
        transfer_ownership: z.boolean().default(false),
      },
    },
    handled((args: { account: string; file_id: string; permission_id: string; role: string; expiration_time: string; remove_expiration: boolean; transfer_ownership: boolean }) =>
      updatePermission(registry.get(args.account), {
        fileId: args.file_id,
        permissionId: args.permission_id,
        role: args.role,
        expirationTime: args.expiration_time,
        removeExpiration: args.remove_expiration,
        transferOwnership: args.transfer_ownership,
      }),
    ),
  );

  server.registerTool(
    "remove_permission",
    {
      title: "Remove someone's access",
      description: `Remove one permission from a file: that person, group, domain or link loses access. Inherited shared-drive access cannot be removed here. ${OUTWARD}`,
      inputSchema: { account: writeAccountArg(), file_id: fileIdArg("file"), permission_id: permissionIdArg() },
    },
    handled((args: { account: string; file_id: string; permission_id: string }) =>
      removePermission(registry.get(args.account), { fileId: args.file_id, permissionId: args.permission_id }),
    ),
  );
};
