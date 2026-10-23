import { offerLink } from "@foreverworks/mcp-kit";

import { AUTHORIZATION_TTL_S, chooseRedirectUri, matchPending } from "../../domain/authorization.js";
import { fail, inputError } from "../../domain/errors.js";
import { bundleFrom, expiries, isoOf } from "../../domain/tokens.js";
import type { Deps } from "../ports.js";

/**
 * Step one of re-authorization: the page the certificate holder opens.
 *
 * The `state` is fresh and remembered in the state dir; complete_authorization
 * accepts only an address carrying it back. Nothing is spent yet: ANAF issues
 * the code only after a person has picked the qualified certificate. Where the
 * client can offer the page to its user itself (MCP URL elicitation), it does;
 * a user who does not hold the certificate declines, and the result keeps the
 * address to pass on.
 */
export const beginAuthorization = async (deps: Deps, args: { readonly redirectUri: string }) => {
  const { authorization, now } = deps;
  const redirectUri = chooseRedirectUri(await authorization.redirectUris(), args.redirectUri);
  const state = authorization.newState();
  const createdAtEpoch = now();
  await authorization.pending.write({ state, redirectUri, createdAtEpoch });
  const authorizeUrl = await authorization.authorizeUrl(redirectUri, state);
  offerLink({
    url: authorizeUrl,
    message:
      "For the holder of the company's qualified certificate: open this in the browser where the certificate is installed and sign in at ANAF. " +
      "The browser then goes to an address with code= in it (the page may fail to load): paste that whole address into this conversation at once, " +
      "as ANAF's code dies 60 seconds after it is issued. If you do not hold the certificate, decline, and the link can be passed on.",
    next:
      "the certificate holder has ANAF's page open; ask them for the whole address the browser lands on (redirectUri with ?code=...&state=...) " +
      "and pass it to complete_authorization as redirect_url AT ONCE: ANAF's code dies 60 seconds after it is issued.",
  });
  return {
    ok: true,
    authorizeUrl,
    redirectUri,
    openUntil: isoOf(createdAtEpoch + AUTHORIZATION_TTL_S),
    next:
      "The CERTIFICATE HOLDER opens authorizeUrl in a browser with the qualified certificate and signs in. The browser then " +
      "lands on redirectUri with ?code=...&state=... in the address (the page itself may fail to load; the " +
      "address is what matters). Pass that whole address to complete_authorization as redirect_url AT ONCE: " +
      "ANAF's code dies 60 seconds after it is issued.",
  };
};

/**
 * Step two: the address the browser landed on, or its `code` and `state`.
 *
 * The state is checked BEFORE the code is spent, and the code is spent once.
 * The tokens go straight to tokens.json; the caller learns two dates.
 */
export const completeAuthorization = async (
  deps: Deps,
  args: { readonly redirectUrl: string; readonly code: string; readonly state: string },
) => {
  const { authorization, tokens, now } = deps;
  if ((args.redirectUrl === "") === (args.code === ""))
    fail(inputError("pass either redirect_url (the whole address) or code with state, not both and not neither"));
  const given = args.redirectUrl === "" ? { code: args.code, state: args.state } : authorization.fromRedirect(args.redirectUrl);
  const code = given.code ?? "";
  if (code === "") fail(inputError("that address carries no code; ANAF sends one only after the certificate step succeeds"));

  const pending = matchPending(await authorization.pending.read(), given.state ?? "", now());
  const minted = await authorization.exchangeCode(code, pending.redirectUri);
  const bundle = bundleFrom(minted, now());
  await tokens.replace(bundle);
  await authorization.pending.clear();
  return { ok: true, ...expiries(bundle) };
};
