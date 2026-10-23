import { bank } from "../../domain/aspsps.js";
import type { Deps } from "../ports.js";

/**
 * Alive, as which application, against which redirect URL.
 *
 * `/application` is the only call that proves the locally signed JWT is
 * accepted, because nothing else here has a grant to check: tokens are minted
 * on the spot from the private key and live five minutes.
 */
export const checkHealth = async ({ bank: api, sessions, identity, paths }: Deps) => {
  const [app, book, application] = await Promise.all([identity(), sessions.read(), api.application()]);
  return {
    ok: true,
    applicationId: app.applicationId,
    applicationName: app.applicationName,
    environment: app.environment,
    redirectUrl: app.redirectUrl,
    storedSessions: book.sessions.length,
    configPath: paths.config,
    privateKeyPath: app.privateKeyPath,
    sessionsPath: paths.sessions,
    application: {
      name: application.name,
      environment: application.environment,
      active: application.active,
      redirectUrls: application.redirect_urls,
      services: application.services,
    },
  };
};

/**
 * The bank catalogue for one country (or every market for an empty one), served
 * from an hour-long in-memory cache (composition.ts, ASPSP_TTL_MS).
 */
export const listAspsps = async (deps: Deps, { country }: { readonly country: string }) => {
  const trimmed = country.trim();
  const aspsps = await deps.bank.listAspsps(trimmed === "" ? undefined : trimmed.toUpperCase());
  return { count: aspsps.length, banks: aspsps.map(bank) };
};
