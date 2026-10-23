import { z } from "zod";

import { copyFile, makeFolder, move, rename, trash, untrash } from "../../app/usecases/organise.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

const fileId = z.string().default("").describe("Drive file id. Takes precedence over path.");
const path = z.string().default("").describe("Path under My Drive.");

export const registerOrganise: Registrar = (server, deps) => {
  server.registerTool(
    "copy_file",
    {
      title: "Copy a file",
      description: "Copy one file to a folder, retaining native Google formats and formulas. Does not copy folders, comments or version history. Refuses existing names; inspect the destination after an uncertain response before retrying. Original is unchanged.",
      inputSchema: {
        file_id: z.string().min(1),
        destination_id: z.string().min(1),
        name: z.string().default(""),
        expected_modified: z.string().optional().describe("Refuse if source modifiedTime differs from this observed value."),
      },
    },
    handled((args: { file_id: string; destination_id: string; name: string; expected_modified?: string | undefined }) =>
      copyFile(deps, { fileId: args.file_id, destinationId: args.destination_id, name: args.name,
        ...(args.expected_modified === undefined ? {} : { expectedModified: args.expected_modified }) }),
    ),
  );
  server.registerTool(
    "move_file",
    {
      title: "Move files",
      description:
        "Move one or many files into a folder, optionally renaming a single one. Sources are paths, or " +
        '"id:<fileId>" to name one directly. Works the same for a Google Doc as for a PDF, which is the ' +
        "reason to use this instead of moving files in a synced local copy: moving a Doc's placeholder there " +
        "deletes the Doc and uploads a small shortcut file in its place. Call with dry_run first; the plan names every collision.",
      inputSchema: {
        sources: z.array(z.string()).min(1).describe('Paths, or "id:<fileId>".'),
        destination_path: z.string().default(""),
        destination_id: z.string().default(""),
        rename_to: z.string().default("").describe("Only legal with a single source."),
        dry_run: z.boolean().default(false).describe("Compute the plan and write nothing."),
      },
    },
    handled((args: { sources: string[]; destination_path: string; destination_id: string; rename_to: string; dry_run: boolean }) =>
      move(deps, {
        sources: args.sources,
        destinationPath: args.destination_path,
        destinationId: args.destination_id,
        renameTo: args.rename_to,
        dryRun: args.dry_run,
      }),
    ),
  );

  server.registerTool(
    "rename_file",
    {
      title: "Rename a file",
      description: "Change a file's name in place. Names cannot contain a slash; Drive has no path, only parents.",
      inputSchema: { file_id: fileId, path, new_name: z.string() },
    },
    handled((args: { file_id: string; path: string; new_name: string }) =>
      rename(deps, { fileId: args.file_id, path: args.path, newName: args.new_name }),
    ),
  );

  server.registerTool(
    "create_folder",
    {
      title: "Create a folder",
      description:
        "Create a folder and every missing folder above it, in one call. Returns which levels it had to " +
        "create, so a typo shows up as a folder you did not expect to be new.",
      inputSchema: { path: z.string().describe("Full path under My Drive.") },
    },
    handled((args: { path: string }) => makeFolder(deps, args.path)),
  );

  server.registerTool(
    "trash_file",
    {
      title: "Move to trash",
      description:
        "Send a file to Drive's trash, where it stays recoverable for 30 days. There is deliberately no " +
        "permanent-delete tool here: the one operation that cannot be undone is the one this server does " +
        "not expose.",
      inputSchema: { file_id: fileId, path },
    },
    handled((args: { file_id: string; path: string }) => trash(deps, { fileId: args.file_id, path: args.path })),
  );

  server.registerTool(
    "untrash_file",
    {
      title: "Restore from trash",
      description: "Take a file back out of the trash. Find it by id; a trashed file no longer answers to its path.",
      inputSchema: { file_id: fileId, path },
    },
    handled((args: { file_id: string; path: string }) => untrash(deps, { fileId: args.file_id, path: args.path })),
  );
};
