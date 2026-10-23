import { describeBundle } from "../../domain/tokens.js";
import type { Deps } from "../ports.js";

/**
 * Is this alive, and will it still be alive next week.
 *
 * Both halves matter and they fail differently. HELLO proves the access token
 * is accepted RIGHT NOW; the stored expiries are the only warning that the
 * refresh window is closing, and that one needs a human with a card reader, so
 * it is worth knowing weeks early rather than on the morning it stops.
 */
export const checkHealth = async ({ anaf, tokens, identity, paths, now }: Deps) => {
  const [bundle, app] = await Promise.all([tokens.read(), identity()]);
  const greeting = await anaf.hello("health");
  return {
    ok: true,
    appName: app.appName,
    clientIdLast4: app.clientIdLast4,
    defaultCif: app.defaultCif,
    hello: greeting,
    configPath: paths.config,
    tokensPath: paths.tokens,
    ...describeBundle(bundle, now()),
  };
};
