import { fail, inputError } from "./errors.js";

/**
 * The one manual step, split so an agent can run it without ever holding the
 * grant: begin_authorization mints a random `state` and remembers it here;
 * the certificate holder opens ANAF's page and picks the qualified certificate; the browser
 * lands on the registered redirect URI with `code` and `state`;
 * complete_authorization accepts that address only if its `state` is the one
 * remembered, exchanges the code, and stores the tokens. The agent sees an
 * authorization code (single use, bound to our client secret, dead within a
 * minute) and two expiry dates, never a token.
 */
export type PendingAuthorization = {
  readonly state: string;
  readonly redirectUri: string;
  readonly createdAtEpoch: number;
};

/**
 * How long a begun authorization stays open. The browser step is a person
 * finding a card reader and a PIN, so minutes rather than seconds; ANAF's own
 * clock is the code's 60 seconds, which starts only once they have signed.
 */
export const AUTHORIZATION_TTL_S = 30 * 60;

/**
 * The redirect URI to send the certificate holder to: the one asked for if it is
 * registered, else the first registered one. ANAF refuses any other, so an
 * unregistered one is refused here, before a person is sent to a browser.
 */
export const chooseRedirectUri = (registered: readonly string[], asked: string): string => {
  const first = registered[0];
  if (first === undefined) return fail(inputError("app.json registers no redirect_uris; ANAF needs the one it has on file"));
  if (asked === "") return first;
  if (!registered.includes(asked))
    return fail(inputError(`redirect_uri "${asked}" is not one app.json registers (${registered.join(", ")})`));
  return asked;
};

/**
 * The pending authorization that `state` answers, or a refusal. A state that
 * does not match is either a stale tab or someone else's redirect, and either
 * way the code must not be spent on our client.
 */
export const matchPending = (pending: PendingAuthorization | undefined, state: string, nowEpoch: number): PendingAuthorization => {
  if (pending === undefined) return fail(inputError("no authorization is in progress; call begin_authorization first"));
  if (state !== pending.state)
    return fail(inputError("the state in that address is not the one begin_authorization issued; start again"));
  if (nowEpoch - pending.createdAtEpoch > AUTHORIZATION_TTL_S)
    return fail(inputError("that authorization was begun more than 30 minutes ago; call begin_authorization again"));
  return pending;
};
