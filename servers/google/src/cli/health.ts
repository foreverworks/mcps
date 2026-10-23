import { inSeries, PERMANENT, worst } from "@foreverworks/mcp-kit";

import { runCalendarHealth } from "./calendarHealth.js";
import { runDriveHealth } from "./driveHealth.js";
import { runEditorsHealth } from "./editorsHealth.js";
import { runGmailHealth } from "./gmailHealth.js";
import { runContactsHealth, runMeetHealth, runTasksHealth } from "./grantHealth.js";

/**
 * `--health [gmail|calendar|drive|editors|tasks|contacts|meet]`: one product, or all of them when none is named.
 *
 * The products keep separate checks and separate line prefixes so a scheduled
 * check can report them separately: each has its own grant and its own fix.
 * All at once is for a human at a terminal.
 */
const PRODUCTS = {
  gmail: runGmailHealth,
  calendar: runCalendarHealth,
  drive: runDriveHealth,
  editors: runEditorsHealth,
  tasks: runTasksHealth,
  contacts: runContactsHealth,
  meet: runMeetHealth,
} as const;

type Product = keyof typeof PRODUCTS;

const isProduct = (name: string): name is Product => Object.hasOwn(PRODUCTS, name);

export const runHealthCheck = async (
  product: string | undefined,
  log: (line: string) => void = console.log,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> => {
  if (product === undefined) {
    return worst(await inSeries(Object.values(PRODUCTS), (run) => run(log, env)));
  }
  if (!isProduct(product)) {
    log(`HEALTH: FAIL unknown product "${product}"; one of: ${Object.keys(PRODUCTS).join(", ")}`);
    return PERMANENT;
  }
  return PRODUCTS[product](log, env);
};
