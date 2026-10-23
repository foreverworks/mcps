import { z } from "zod";

import { DOWNLOAD_FORMATS } from "../../../drive/domain/download.js";
import { fileIdArg, readAccountArg, writeAccountArg } from "../../../editors/mcp/args.js";
import type { Registrar } from "../../../editors/mcp/registrar.js";
import { downloadRevision, listRevisions, updateRevision } from "../../app/usecases/revisions.js";
import type { Registry } from "../../composition.js";
import { handled } from "../envelope.js";

const revisionIdArg = () => z.string().min(1).describe("The revision's id, from list_revisions.");

/** A file's history: who changed it when, an old version saved, a version kept or published. */
export const registerRevisions: Registrar<Registry> = (server, registry) => {
  server.registerTool(
    "list_revisions",
    {
      title: "List a file's revisions",
      description:
        "A Drive file's revisions, oldest first: id, time, who made it, size and checksum for files with bytes, whether it is kept " +
        "forever or published, and for a Doc, Sheet or deck the formats an old revision can be saved as with download_revision.",
      inputSchema: { account: readAccountArg(), file_id: fileIdArg("file") },
    },
    handled((args: { account: string; file_id: string }) => listRevisions(registry.get(args.account), { fileId: args.file_id })),
  );

  server.registerTool(
    "download_revision",
    {
      title: "Save an old revision",
      description:
        "One revision of a file into the downloads folder: a file with bytes as it was, checked against the revision's MD5; a Google " +
        "file exported (a Doc as PDF unless `format` says otherwise). Returns the path, size and sha256. To roll back, upload it as a new version.",
      inputSchema: {
        account: readAccountArg(),
        file_id: fileIdArg("file"),
        revision_id: revisionIdArg(),
        format: z.enum(["", ...DOWNLOAD_FORMATS]).default("").describe("For a Google file: what to save it as."),
        save_dir: z.string().default("").describe("A folder inside the downloads folder."),
        filename: z.string().default("").describe("Defaults to the file's name with the revision id."),
      },
    },
    handled((args: { account: string; file_id: string; revision_id: string; format: string; save_dir: string; filename: string }) =>
      downloadRevision(registry.get(args.account), {
        fileId: args.file_id,
        revisionId: args.revision_id,
        format: args.format,
        saveDir: args.save_dir,
        filename: args.filename,
      }),
    ),
  );

  server.registerTool(
    "update_revision",
    {
      title: "Keep or publish a revision",
      description:
        "keep_forever stops Drive pruning a revision of a file with bytes. published puts a Doc, Sheet or deck revision on the web " +
        "for anyone at its publishedLink (publish_auto follows later revisions, published_outside_domain lets people outside the " +
        "domain read it): only on the user's explicit go.",
      inputSchema: {
        account: writeAccountArg(),
        file_id: fileIdArg("file"),
        revision_id: revisionIdArg(),
        keep_forever: z.boolean().optional(),
        published: z.boolean().optional(),
        publish_auto: z.boolean().optional(),
        published_outside_domain: z.boolean().optional(),
      },
    },
    handled(
      (args: {
        account: string;
        file_id: string;
        revision_id: string;
        keep_forever?: boolean | undefined;
        published?: boolean | undefined;
        publish_auto?: boolean | undefined;
        published_outside_domain?: boolean | undefined;
      }) =>
        updateRevision(registry.get(args.account), {
          fileId: args.file_id,
          revisionId: args.revision_id,
          ...(args.keep_forever === undefined ? {} : { keepForever: args.keep_forever }),
          ...(args.published === undefined ? {} : { published: args.published }),
          ...(args.publish_auto === undefined ? {} : { publishAuto: args.publish_auto }),
          ...(args.published_outside_domain === undefined ? {} : { publishedOutsideDomain: args.published_outside_domain }),
        }),
    ),
  );
};
