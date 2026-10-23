import type { McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { readAccountArg } from "../../grants/args.js";
import { findPeople } from "../app/usecases.js";
import type { Registry } from "../composition.js";
import { type Source, SOURCES } from "../domain/grants.js";
import { handled } from "./envelope.js";

export const registerAll = (server: McpServer, registry: Registry): void => {
  server.registerTool(
    "find_people",
    {
      title: "Find people",
      description:
        "Find a person's email address by name, across every account at once: each account's contacts, the addresses " +
        "Gmail saved from mail it sent or received ('other'), and a Workspace domain's directory. The query matches the " +
        "start of a name, an address, a phone number or an organisation. One entry per person, merged by address, with " +
        "every account and source it was found in; a source an account cannot read is listed under `unavailable` with " +
        "the reason. Use it before addressing a draft or an invitation to someone named.",
      inputSchema: {
        query: z.string().min(1).describe('A name or its start ("Ana Pop"), or the start of an address or a phone number.'),
        account: readAccountArg(),
        sources: z.array(z.enum(SOURCES)).min(1).default([...SOURCES]).describe('Where to look: "contacts", "other" (saved from mail) and "directory" (Workspace). Default all three.'),
        limit: z.number().int().min(1).max(30).default(10).describe("Per account and source, before merging."),
      },
    },
    handled((a: { query: string; account: string; sources: Source[]; limit: number }) =>
      findPeople(registry.select(a.account), { query: a.query, sources: [...new Set(a.sources)], limit: a.limit }),
    ),
  );
};
