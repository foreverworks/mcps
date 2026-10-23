/**
 * What of HELLO's answer may leave the adapter: its first line, and only when
 * that line carries nothing of the request.
 *
 * TestOauth's hello ECHOES THE REQUEST HEADERS, `Authorization: Bearer <access
 * token>` among them, so returning any of its body could put a live access
 * token into a model's context. So the answer is cut at the first line break,
 * and a line that still names a header or looks like a token is withheld whole
 * rather than scrubbed: a scrub that misses one format is a leak.
 */
const REQUEST_ECHO = /authori[sz]ation|bearer|token|cookie|eyJ[A-Za-z0-9_-]{8,}/i;

/** Long enough for "Hello health" and its like, too short to carry a JWT. */
const MAX_GREETING = 80;

export const WITHHELD_GREETING = "answered; the greeting echoed the request, so it is withheld";

export const greetingOf = (body: string): string => {
  const first = body.trimStart().split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (first === "") return "answered with an empty body";
  return REQUEST_ECHO.test(first) || first.length > MAX_GREETING ? WITHHELD_GREETING : first;
};
