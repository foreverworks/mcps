import { join } from "node:path";

import { envPath } from "@foreverworks/mcp-kit";

import { buildGrant } from "../grants/grant.js";
import { type GrantRegistry, makeGrantRegistry } from "../grants/registry.js";
import { googleStateDir } from "../infra/locations.js";
import type { Deps, EventOfMeeting } from "./app/ports.js";
import { makeMeetApi } from "./infra/meetApi.js";

export type Registry = GrantRegistry<Deps>;

/** How an account reads one of its calendar events: through Calendar's own grant for that account. */
export type EventReader = (account: string) => (calendarId: string, eventId: string) => Promise<EventOfMeeting>;

/**
 * Meet's records, one grant per account under MEET_ROOT
 * (`<root>/<label>/credentials.json`, written by consent, product meet),
 * discovered on every lookup. An event is read through Calendar, so finding
 * an event's meeting needs both grants for that account.
 */
export const buildRegistry = (env: NodeJS.ProcessEnv, eventOf: EventReader): Registry =>
  makeGrantRegistry("meet", envPath(env, "MEET_ROOT") ?? join(googleStateDir(env), "meet"), (spec) => {
    const { grant, request } = buildGrant(spec, "Google Meet");
    return { grant, meet: makeMeetApi(request), eventOf: eventOf(spec.label), now: () => Date.now() };
  });
