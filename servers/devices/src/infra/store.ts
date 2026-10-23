import { join } from "node:path";

import { readJsonFile, writeJsonFile } from "@foreverworks/mcp-kit";

import type { StorePort } from "../app/ports.js";
import type { BrokerState } from "../domain/state.js";

const VERSION = 1;

/** The broker's state as one JSON file in its state directory, written whole and atomically. */
export const makeStore = (stateDir: string): StorePort => {
  const path = join(stateDir, "state.json");
  return {
    load: async () => {
      const file = await readJsonFile<{ version?: number; state?: BrokerState }>(path);
      return file?.version === VERSION ? file.state : undefined;
    },
    save: (state) => writeJsonFile(path, { version: VERSION, state }, { mode: 0o600 }),
  };
};
