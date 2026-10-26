import { compact } from "@foreverworks/mcp-kit";

import { countsPerDomain } from "../../domain/entities.js";
import { asAppError, remedyFor } from "../../domain/errors.js";
import type { Deps } from "../ports.js";

/** A failure as one line of health's problems, with what to do about it, or a rethrow when it is a bug. */
const problemOf = (thrown: unknown, what: string): string => {
  const known = asAppError(thrown);
  if (known === undefined) throw thrown;
  return `${what}: ${known.kind}: ${known.message} (${remedyFor(known)})`;
};

/**
 * Whether this server works with its instance: the REST API answers and
 * takes the token, Home Assistant says it is running (not starting, not in
 * recovery mode), and the WebSocket API signs in too, since the area tools
 * need it. One request at a time, and none after a refusal: each refused
 * token is a failed login to Home Assistant.
 */
export const health = async (deps: Deps) => {
  let url: string;
  try {
    url = deps.instance().url;
  } catch (thrown) {
    return { ok: false, problems: [problemOf(thrown, "configuration")] };
  }
  try {
    deps.confirmDomains();
  } catch (thrown) {
    return { ok: false, url, problems: [problemOf(thrown, "configuration")] };
  }
  let config: Awaited<ReturnType<Deps["ha"]["config"]>>;
  try {
    config = await deps.ha.config();
  } catch (thrown) {
    return { ok: false, url, problems: [problemOf(thrown, "REST API")] };
  }
  const problems: string[] = [];
  if (config.state !== "RUNNING") problems.push(`Home Assistant is ${config.state}, not RUNNING`);
  if (config.recoveryMode) problems.push("Home Assistant runs in recovery mode: its configuration did not load, so most integrations are missing");
  if (config.safeMode) problems.push("Home Assistant runs in safe mode: custom integrations are not loaded");
  let states: Awaited<ReturnType<Deps["ha"]["states"]>> | undefined;
  try {
    states = await deps.ha.states();
  } catch (thrown) {
    problems.push(problemOf(thrown, "states"));
  }
  let websocket: string | undefined;
  try {
    await deps.ha.socketCheck();
    websocket = "ok";
  } catch (thrown) {
    problems.push(problemOf(thrown, "WebSocket API"));
  }
  return compact({
    ok: problems.length === 0,
    problems: problems.length === 0 ? undefined : problems,
    url,
    version: config.version,
    state: config.state,
    time_zone: config.timeZone,
    location_name: config.locationName,
    websocket,
    entities: states?.length,
    entities_per_domain: states === undefined ? undefined : countsPerDomain(states),
  });
};
