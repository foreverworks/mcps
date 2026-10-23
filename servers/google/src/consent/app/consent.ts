import { authorizeUrl, newPkce, newState, offerLink, parseRedirect } from "@foreverworks/mcp-kit";

import { LABEL } from "../../domain/accounts.js";
import { splitScopes } from "../../domain/scopes.js";
import { type ConsentProduct, expiresAt, missingScopes, requestedScopes, sameAddress } from "../domain/consent.js";
import { authError, fail, inputError } from "../domain/errors.js";
import type { Deps } from "./ports.js";

/**
 * Consent through the server, so a service can keep its grants in a state dir
 * its caller can neither read nor write.
 *
 * The user's side is the installed-app flow: the URL opens in a browser, the
 * user approves as the account named, the redirect to the loopback URI fails
 * to load (nothing listens there), and the URL it tried to reach is read from
 * the address bar. The PKCE verifier and the grant stay inside the server, and
 * the caller only ever sees a URL. Where the client can offer the URL to its
 * user itself (MCP URL elicitation), it does, and the result then tells the
 * model only what comes next.
 */
export const beginConsent = async (deps: Deps, args: { readonly product: ConsentProduct; readonly account: string }) => {
  if (!LABEL.test(args.account)) return fail(inputError(`"${args.account}" is not an account label`));
  const target = await deps.target(args.product, args.account);
  const client = await target.client();
  const pkce = newPkce(deps.random);
  const state = newState(deps.random);
  const pending = {
    state,
    verifier: pkce.verifier,
    product: target.product,
    account: target.account,
    client,
    scopes: target.scopes,
    redirectUri: deps.redirectUri,
    createdAt: deps.now(),
  };
  await deps.pending.put(pending);
  const url = authorizeUrl({
    authUri: deps.authUri,
    clientId: client.clientId,
    redirectUri: deps.redirectUri,
    scopes: requestedScopes([...target.scopes, ...(target.optionalScopes ?? [])]),
    state,
    pkce,
    // offline + consent: a refresh token every time, not only on the first approval.
    extra: { access_type: "offline", prompt: "consent", login_hint: target.address },
  });
  const expires = new Date(expiresAt(pending)).toISOString();
  offerLink({
    url,
    message:
      `Approve ${target.product} for ${target.address} at Google, signed in as that account, and tick every box. ` +
      "The page it then goes to fails to load: copy its whole address and paste it into this conversation within 15 minutes.",
    next:
      `the user is approving as ${target.address} in their browser; ask them for the address it then fails to load ` +
      `(${deps.redirectUri}?...) and pass that whole URL to complete_consent before ${expires}`,
  });
  return {
    url,
    expires_at: expires,
    product: target.product,
    account: target.account,
    address: target.address,
    scopes: [...target.scopes, ...(target.optionalScopes ?? [])],
    ...(target.optionalScopes?.length ? { optional: target.optionalScopes } : {}),
    next:
      `open the url in a browser; approve as ${target.address} and tick every box; ` +
      `the browser then fails to load ${deps.redirectUri}?...: pass that whole URL to complete_consent`,
  };
};

/**
 * Finish a consent from the URL its redirect tried to reach, and save the
 * grant where the product reads it. Refused, with nothing written, when the
 * user approved as another account, left a box unticked, or Google gave no
 * refresh token. The waiting consent is spent by the first attempt whatever
 * happens, because Google's code is single-use too.
 */
export const completeConsent = async (deps: Deps, args: { readonly redirectUrl: string }) => {
  const redirect = parseRedirect(args.redirectUrl);
  if (redirect.kind === "invalid") return fail(inputError(`not the redirect of a consent: ${redirect.message}`));
  const pending = await deps.pending.take(redirect.state ?? "", deps.now());
  if (!pending) {
    return fail(inputError("no consent is waiting for that state: it expired (15 minutes), was already completed, or was begun elsewhere"));
  }
  if (redirect.kind === "refused") {
    return fail(inputError(`Google answered ${redirect.error}${redirect.description ? ` (${redirect.description})` : ""}: the consent was not approved`));
  }

  const target = await deps.target(pending.product, pending.account);
  const granted = await deps.exchange(pending.client, redirect.code, pending.redirectUri, pending.verifier);
  const missing = missingScopes(pending.scopes, granted.scope);
  if (missing.length > 0) {
    return fail(authError("insufficient_scope", `granted ${granted.scope ?? "nothing"} but not ${missing.join(", ")}: a box was left unticked; nothing was saved`));
  }
  if (!granted.refreshToken) return fail(authError("no_refresh_token", "Google gave no refresh token; nothing was saved"));
  const approvedAs = (await deps.whoApproved(granted.accessToken)).email;
  if (!approvedAs || !sameAddress(approvedAs, target.address)) {
    return fail(authError("wrong_account", `approved as ${approvedAs ?? "an account Google did not name"}, not ${target.address}; nothing was saved`));
  }

  const scopes = splitScopes(granted.scope);
  await deps.save(target.credentialsPath, { client: pending.client, refreshToken: granted.refreshToken, scopes, account: target.address });
  await target.forget();
  return { product: target.product, account: target.account, address: target.address, scopes, saved: true as const, path: target.credentialsPath };
};
