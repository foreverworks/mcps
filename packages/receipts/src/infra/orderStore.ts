import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { OrderStore } from "../app/ports.js";

/**
 * One JSON file per settled order, under the state dir, holding the app's RAW
 * payload: a fix to a receipt mapping then applies to every stored order
 * without refetching hundreds of them at a paced few per second.
 *
 * Files rather than one big JSON, because more than one process (the service,
 * a `--health` run, a session's own copy) uses the same directory: a write is a
 * rename of a whole file, so two processes storing different orders never
 * clobber each other, and two storing the same order write the same bytes. A
 * file that fails to parse reads as absent and is simply fetched again.
 *
 * The payload holds the delivery address, so files are 0600 in a 0700 dir.
 */
export const makeOrderStore = <Raw>(dir: string): OrderStore<Raw> => {
  const pathOf = (orderId: number) => join(dir, `${orderId}.json`);

  return {
    read: async (orderId) => {
      try {
        return JSON.parse(await readFile(pathOf(orderId), "utf8")) as Raw;
      } catch {
        return undefined;
      }
    },
    write: async (orderId, details) => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = `${pathOf(orderId)}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(details), { mode: 0o600 });
      await rename(tmp, pathOf(orderId));
    },
    count: async () => {
      try {
        return (await readdir(dir)).filter((f) => f.endsWith(".json")).length;
      } catch {
        return 0;
      }
    },
  };
};
