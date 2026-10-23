/**
 * What a JWT says about itself, read WITHOUT verifying it.
 *
 * Verification is the app's job and happens on every call. This only answers
 * the operator's questions ("whose account", "how long until a human must
 * re-extract it"), none of which needs the signature. Which claims answer them
 * is each app's: bolt-food and glovo map these claims to their own facts.
 */

const base64UrlDecode = (segment: string): string =>
  atob(segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "="));

/** A JSON object, or undefined for anything else (not JSON, or JSON that is not an object). */
export const jsonObject = (text: string): Readonly<Record<string, unknown>> | undefined => {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

/** The claims of a JWT; undefined when it is not one. */
export const jwtClaims = (jwt: string): Readonly<Record<string, unknown>> | undefined => {
  const segment = jwt.split(".")[1];
  if (!segment) return undefined;
  try {
    return jsonObject(base64UrlDecode(segment));
  } catch {
    // atob refuses a segment that is not base64 at all.
    return undefined;
  }
};
