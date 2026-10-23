/**
 * Who the session belongs to, read from the access token's claims.
 *
 * Keycloak's access token is a JWT; its payload names the account
 * (`preferred_username`, `name`, `email`) and when it expires (`exp`). The
 * signature is NOT checked here: the token was handed to this server by
 * Keycloak itself over TLS, and these claims only ever reach session_status.
 * A token that is not a JWT yields nothing rather than a failure. Pure.
 */
export type Claims = {
  readonly username?: string | undefined;
  readonly name?: string | undefined;
  readonly email?: string | undefined;
  readonly subject?: string | undefined;
  readonly expEpoch?: number | undefined;
};

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

export const claimsOf = (jwt: string): Claims => {
  const payload = jwt.split(".")[1];
  if (payload === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const c = parsed as Record<string, unknown>;
  const exp = typeof c["exp"] === "number" ? c["exp"] : undefined;
  return { username: text(c["preferred_username"]), name: text(c["name"]), email: text(c["email"]), subject: text(c["sub"]), expEpoch: exp };
};
