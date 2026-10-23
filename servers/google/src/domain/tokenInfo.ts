/**
 * What Google's tokeninfo endpoint says about an access token: who it belongs
 * to and what it grants. No Discovery document covers this endpoint, so the
 * shape is modelled by hand from Google's OAuth 2.0 documentation
 * (https://developers.google.com/identity/protocols/oauth2, "tokeninfo")
 * and parsed at the boundary (infra/tokenInfo.ts), where a
 * change in it fails loudly. Every field may be absent; `email` is there only
 * when the token carries the userinfo.email scope.
 */
export type TokenInfo = {
  /** The OAuth client the token was issued to: the one field that names the console client. */
  readonly aud?: string;
  /** The granted scopes, space-separated. */
  readonly scope?: string;
  readonly email?: string;
  /** "true" or "false", as a string. */
  readonly email_verified?: string;
  /** Seconds left, as a string. */
  readonly expires_in?: string;
};
