import { type InputFiles, noteHandedBack } from "@foreverworks/mcp-kit";

import { saveNew } from "../../infra/saveNew.js";
import type { FilePort } from "../app/ports.js";

/**
 * Attachments out are written whole and never over another file (saveNew):
 * two attachments of one name both survive, and saving one twice makes one
 * file; each is linked in the call's result. Files in are read by the kit's
 * input-file reader, bound to this process's roots (MCP_FILE_ROOTS).
 */
export const makeFiles = (readInput: InputFiles): FilePort => ({
  writeFile: async (dir, name, bytes) => {
    const path = await saveNew(dir, name, bytes);
    noteHandedBack(path, bytes.length);
    return path;
  },
  readInput,
});
