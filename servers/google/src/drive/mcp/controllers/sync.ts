import { z } from "zod";

import { changesSince, currentCursor } from "../../app/usecases/sync.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

export const registerSync: Registrar = (server, deps) => {
  server.registerTool(
    "start_drive_cursor",
    {
      title: "Mint a change cursor",
      description:
        'A token meaning "from now on". Keep it, and hand it to drive_changes later. This is the cheap half of ' +
        "keeping anything in step with Drive: one call, no listing.",
      inputSchema: {},
    },
    handled(() => currentCursor(deps)),
  );

  server.registerTool(
    "drive_changes",
    {
      title: "What changed since the cursor",
      description:
        "Every file created, edited, moved, trashed or removed since the cursor, and a new cursor to use " +
        "next time. Only the delta comes back, so this costs the same whether the Drive holds 20 files or " +
        "20,000. Call it again while exhausted is false to drain the backlog.",
      inputSchema: {
        cursor: z.string().describe("A cursor from start_drive_cursor or from a previous drive_changes call."),
        limit: z.number().int().min(1).max(1000).default(200),
      },
    },
    handled((args: { cursor: string; limit: number }) => changesSince(deps, args)),
  );
};
