import type { OutputOf } from "@foreverworks/mcp-kit";

import { checkHealth, listProjects } from "../../app/usecases/projects.js";
import { handled } from "../envelope.js";
import { PROJECTS_OUTPUT } from "../outputs.js";
import type { Registrar } from "./types.js";

export const registerProjects: Registrar = (server, deps) => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Check that the Expo access token is present and accepted: which actor it is (a robot user, ideally), its accounts and the " +
        "projects it sees. Reads only. Run this before concluding the server is broken.",
      inputSchema: {},
    },
    handled(() => checkHealth(deps)),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "The EAS projects this token can see, per account, with their full names (@account/slug) and ids: what every other tool's " +
        "project argument takes. A tool may leave project out when the token sees only one.",
      inputSchema: {},
      outputSchema: PROJECTS_OUTPUT,
    },
    handled((): Promise<OutputOf<typeof PROJECTS_OUTPUT>> => listProjects(deps)),
  );
};
