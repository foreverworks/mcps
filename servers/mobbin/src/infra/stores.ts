import { join } from "node:path";

import { pendingPkceAuthorizationFile, storedFile } from "@foreverworks/mcp-kit";

import type { Stores } from "../app/ports.js";
import { clientFromDisk, clientOnDisk, clientToDisk, grantFromDisk, grantOnDisk, grantToDisk, toolsFromDisk, toolsOnDisk, toolsToDisk } from "../domain/schema.js";

/** The files of the state directory, each 0600 and written whole. */
export const GRANT_FILE = "grant.json";

export const makeStores = (stateDir: string): Stores => ({
  client: storedFile(join(stateDir, "client.json"), { schema: clientOnDisk, fromDisk: clientFromDisk, toDisk: clientToDisk, lock: "client.lock" }),
  candidate: storedFile(join(stateDir, "candidate.json"), { schema: clientOnDisk, fromDisk: clientFromDisk, toDisk: clientToDisk, lock: "candidate.lock" }),
  pending: pendingPkceAuthorizationFile(stateDir, "pending"),
  grant: storedFile(join(stateDir, GRANT_FILE), { schema: grantOnDisk, fromDisk: grantFromDisk, toDisk: grantToDisk, lock: "grant-file.lock" }),
  tools: storedFile(join(stateDir, "tools.json"), { schema: toolsOnDisk, fromDisk: toolsFromDisk, toDisk: toolsToDisk }),
});
