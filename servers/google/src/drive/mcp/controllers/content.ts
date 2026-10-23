import { z } from "zod";

import { readDoc } from "../../app/usecases/content.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

export const registerContent: Registrar = (server, deps) => {
  server.registerTool(
    "read_doc",
    {
      title: "Read a Google Doc",
      description:
        "Export a Google Doc, Sheet or Slide deck as text and return it. Sheets come back as CSV. A Doc has " +
        "no bytes to download, and this fetches its words in one request. Binary files are refused on " +
        "purpose; download_file saves their bytes.",
      inputSchema: {
        file_id: z.string().default(""),
        path: z.string().default(""),
        format: z.enum(["text", "markdown", "html"]).default("text"),
        max_chars: z.number().int().min(100).max(400_000).default(40_000),
      },
    },
    handled((args: { file_id: string; path: string; format: string; max_chars: number }) =>
      readDoc(deps, { fileId: args.file_id, path: args.path, format: args.format, maxChars: args.max_chars }),
    ),
  );
};
