import type { HttpRequest } from "@foreverworks/mcp-kit";

import type { StatusPort } from "../app/ports.js";
import { componentsWire, incidentsWire, schedulesWire } from "../domain/schema.js";
import { parseOrDrift } from "./wire.js";

/**
 * CNAIR's public status page for eToll (a Cachet instance under `/status`):
 * its components, incidents and scheduled maintenance, JSON:API, no account.
 */
export const makeStatusApi = (http: HttpRequest, origin: string): StatusPort => {
  const base = `${origin}/status/api`;
  return {
    components: async () => parseOrDrift(componentsWire, await http(`${base}/components`, { query: { per_page: 100 } }), "status components"),
    incidents: async () => parseOrDrift(incidentsWire, await http(`${base}/incidents`, { query: { per_page: 20, sort: "-id" } }), "status incidents"),
    schedules: async () => parseOrDrift(schedulesWire, await http(`${base}/schedules`, { query: { per_page: 20, sort: "-id" } }), "status schedules"),
  };
};
