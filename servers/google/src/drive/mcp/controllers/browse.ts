import { z } from "zod";

import { describe, find, listFolder, resolvePath } from "../../app/usecases/browse.js";
import { pathOf } from "../../app/usecases/organise.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

const fileId = z.string().default("").describe("Drive file id. Takes precedence over path.");
const path = z.string().default("").describe('Path under My Drive, e.g. "Reports/2026". Empty means the root.');
const limit = z.number().int().min(1).max(5000).default(200);
const includeTrashed = z.boolean().default(false);

export const registerBrowse: Registrar = (server, deps) => {
  server.registerTool(
    "resolve_path",
    {
      title: "Resolve a path to an id",
      description:
        "Walk a path and return the id it names. A path is a QUERY on Drive, not an address: two objects " +
        "may hold the same name in one folder, and this reports that as an error listing both ids rather " +
        "than picking one. Use it before any tool that writes. A Drive name may itself contain a slash " +
        '(Google Meet writes folders like "Weekly sync - 2030/01/15"); those are reachable only by id, ' +
        "which find_files returns.",
      inputSchema: { path: z.string().describe("Path under My Drive.") },
    },
    handled((args: { path: string }) => resolvePath(deps, args.path)),
  );

  server.registerTool(
    "path_of",
    {
      title: "Path of an id",
      description: "The reverse of resolve_path: where a file sits, as a path, by walking its parents to the root.",
      inputSchema: { file_id: z.string().describe("Drive file id.") },
    },
    handled((args: { file_id: string }) => pathOf(deps, args.file_id)),
  );

  server.registerTool(
    "list_folder",
    {
      title: "List a folder",
      description:
        "The direct children of one folder. Give file_id or path; empty path means the root of My Drive. " +
        "Google Docs come back with isNative true and bytes null, because a Doc has no stored bytes.",
      inputSchema: { file_id: fileId, path, include_trashed: includeTrashed, limit },
    },
    handled((args: { file_id: string; path: string; include_trashed: boolean; limit: number }) =>
      listFolder(deps, { fileId: args.file_id, path: args.path, includeTrashed: args.include_trashed, limit: args.limit }),
    ),
  );

  server.registerTool(
    "find_files",
    {
      title: "Search Drive",
      description:
        "Search the whole Drive without listing it. Combine any of name_contains, full_text, mime_type, " +
        "parent_id and modified_after; they are ANDed. This is the tool to reach for instead of walking " +
        "folders, or a local copy of the Drive, which costs a full tree scan for the same answer.",
      inputSchema: {
        name_contains: z.string().default(""),
        full_text: z.string().default("").describe("Search inside document contents, Google's own index."),
        mime_type: z.string().default("").describe('e.g. "application/vnd.google-apps.folder" or "application/pdf".'),
        parent_id: z.string().default("").describe("Restrict to one folder's direct children."),
        modified_after: z.string().default("").describe("RFC 3339; a bare date means midnight UTC."),
        include_trashed: includeTrashed,
        limit,
      },
    },
    handled(
      (args: {
        name_contains: string;
        full_text: string;
        mime_type: string;
        parent_id: string;
        modified_after: string;
        include_trashed: boolean;
        limit: number;
      }) =>
        find(deps, {
          ...(args.name_contains ? { nameContains: args.name_contains } : {}),
          ...(args.full_text ? { fullText: args.full_text } : {}),
          ...(args.mime_type ? { mimeType: args.mime_type } : {}),
          ...(args.parent_id ? { parentId: args.parent_id } : {}),
          ...(args.modified_after ? { modifiedAfter: args.modified_after } : {}),
          includeTrashed: args.include_trashed,
          limit: args.limit,
        }),
    ),
  );

  server.registerTool(
    "describe_file",
    {
      title: "Describe one file",
      description: "Everything Drive reports about a single file or folder, by id or path.",
      inputSchema: { file_id: fileId, path },
    },
    handled((args: { file_id: string; path: string }) => describe(deps, { fileId: args.file_id, path: args.path })),
  );
};
