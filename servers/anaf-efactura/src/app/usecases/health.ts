import { asAppError } from "../../domain/errors.js";
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

/**
 * A document ANAF will not validate, and a registered company's CIF (the
 * national road infrastructure company's, which the registry publishes): an
 * answer is all a probe is after. What a probe says is only whether ANAF's
 * public host answered, never that a tool will find what a caller asks for.
 */
const PROBE_CIF = "16054368";
const PROBE_DOCUMENT = "<Invoice/>";

type Probe = { readonly reachable: true } | { readonly reachable: false; readonly error: string };

const probe = async (ask: () => Promise<unknown>): Promise<Probe> => {
  try {
    await ask();
    return { reachable: true };
  } catch (thrown) {
    const known = asAppError(thrown);
    return { reachable: false, error: known === undefined ? String(thrown) : known.message };
  }
};

/**
 * Health with no grant: what this server has is ANAF's public host, so that is
 * what it asks about. The registry and the validation service are probed, each
 * with a question that has an answer (an unknown CIF, a document that fails
 * validation) and costs nothing; the PDF and seal checks share the host and are
 * not probed, since they need a document of their own and say so. `ok` is
 * whether the probed services answered, which is all this can know.
 */
export const checkPublicHealth = async ({ anaf, now }: Deps) => {
  const [vatRegistry, validation] = await Promise.all([
    probe(() => anaf.companies([PROBE_CIF], new Date(now() * 1000).toISOString().slice(0, 10))),
    probe(() => anaf.validate(PROBE_DOCUMENT, "FACT1")),
  ]);
  return {
    ok: vatRegistry.reachable && validation.reachable,
    grant: "none: this server uses only ANAF's public services and holds no credential",
    endpoints: { vatRegistry, validation },
    notProbed: "invoice_pdf and verify_signature use the same public host and need a document, so they are not tried here",
  };
};

/** The health this server answers with: the grant's when it has one, else ANAF's public services'. */
export const healthOf = (deps: Deps) => (deps.mode.grantless ? checkPublicHealth(deps) : checkHealth(deps));
