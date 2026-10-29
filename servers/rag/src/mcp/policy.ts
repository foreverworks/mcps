import { summaryFrom, type ToolPolicy } from "@foreverworks/mcp-kit";
import { z } from "zod";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts). Indexing and removing
 * sources write only this server's own index, which can be rebuilt from the
 * files, so they are plain writes. Dropping a collection throws away
 * everything indexed in it at once, so a person approves each call.
 */
const dropLine = summaryFrom(z.object({ name: z.string() }).loose(), (a) => `drop the collection ${a.name} and everything indexed in it`);

export const POLICY: ToolPolicy = {
  health: { access: "read" },
  list_collections: { access: "read" },
  create_collection: { access: "write", idempotent: true },
  drop_collection: { access: "write", confirm: true, summary: dropLine },
  index_path: { access: "write", idempotent: true },
  remove_source: { access: "write", idempotent: true },
  list_sources: { access: "read" },
  search: { access: "read" },
  expand: { access: "read" },
  read_document: { access: "read" },
};
