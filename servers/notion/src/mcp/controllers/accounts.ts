import { compact, type OutputOf } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { checkHealth, listAccounts } from "../../app/usecases/accounts.js";
import { search } from "../../app/usecases/search.js";
import { listUsers } from "../../app/usecases/users.js";
import { account, cursor } from "../args.js";
import { handled } from "../envelope.js";
import { USERS_OUTPUT } from "../outputs.js";
import type { ArgsOf, Registrar } from "./types.js";

const HEALTH = { account };

const USERS = {
  query: z.string().trim().min(1).optional().describe("Words in a name or an email. Leave it out to list everyone."),
  account,
};

const SEARCH = {
  query: z.string().trim().optional().describe("Words in the title. Leave it out to list everything, newest edit first."),
  kind: z.enum(["page", "database"]).optional().describe("Only pages, or only databases."),
  account,
  limit: z.number().int().min(1).max(100).default(20).describe("Hits per workspace; across several workspaces, up to this many from each."),
  cursor,
};

/** The tools about the workspaces themselves, and the one that finds things in them. */
export const registerAccounts: Registrar = (server, deps) => {
  server.registerTool(
    "list_accounts",
    {
      title: "List accounts",
      description:
        "The Notion workspaces this server reaches, by label (one per token file), from the token files alone: no " +
        "request to Notion. Every other tool finds an id's workspace by itself, so a label is needed only to narrow a " +
        "search. Says nothing about whether a token works; that is health.",
      inputSchema: {},
    },
    handled(() => listAccounts(deps)),
  );

  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Ask each workspace: is its integration token accepted, which workspace and integration it is, and whether it " +
        "sees any page at all (a new integration sees nothing until pages are shared with it). One broken workspace " +
        "never hides the others' answers. Run this before concluding the server is broken.",
      inputSchema: HEALTH,
    },
    handled((args: ArgsOf<typeof HEALTH>) => checkHealth(deps, args.account)),
  );

  server.registerTool(
    "list_users",
    {
      title: "List users",
      description:
        "The people (and bots) of every workspace, or of the one account names: each one's id, name, and email when the " +
        "token may read it. A person column's where takes a name or an email directly, so this is for checking who is " +
        "who, or for the id when two people share a name.",
      inputSchema: USERS,
      outputSchema: USERS_OUTPUT,
    },
    handled((args: ArgsOf<typeof USERS>): Promise<OutputOf<typeof USERS_OUTPUT>> => listUsers(deps, compact({ query: args.query, account: args.account }))),
  );

  server.registerTool(
    "search",
    {
      title: "Search",
      description:
        "Pages and databases by title, in every workspace at once unless account names one. Notion matches words in " +
        "titles, not in page bodies. Each hit says its workspace, kind, id and parent; a database hit also carries " +
        "the dataSourceId of its table. Only what is shared with the workspace's integration can be found. A workspace " +
        "that fails is listed under failed, beside the others' hits.",
      inputSchema: SEARCH,
    },
    handled((args: ArgsOf<typeof SEARCH>) =>
      search(deps, { limit: args.limit, ...compact({ query: args.query || undefined, kind: args.kind, account: args.account, cursor: args.cursor }) }),
    ),
  );
};
