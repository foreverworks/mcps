import { fail, unavailable } from "../domain/errors.js";

/** Have I Been Pwned's range endpoint: a prefix in, every suffix of its range out. */
const RANGE = "https://api.pwnedpasswords.com/range/";
/** The range API answers from a CDN in well under a second. */
const TIMEOUT_MS = 15_000;

/**
 * One range, as text. `Add-Padding` asks for decoy entries, so the size of the
 * answer says nothing about the range either. No credential: the API needs none.
 */
export const makePwnedRange =
  (timeoutMs = TIMEOUT_MS) =>
  async (prefix: string): Promise<string> => {
    if (!/^[0-9A-F]{5}$/.test(prefix)) return fail(unavailable("a range prefix is five upper-case hex characters"));
    let response: Response;
    try {
      response = await fetch(`${RANGE}${prefix}`, {
        headers: { "Add-Padding": "true", "User-Agent": "foreverworks-mcp-bitwarden" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (cause) {
      return fail(unavailable(`Have I Been Pwned did not answer: ${cause instanceof Error ? cause.message : String(cause)}`));
    }
    if (!response.ok) {
      await response.body?.cancel();
      return fail(unavailable(`Have I Been Pwned answered ${response.status}`));
    }
    return response.text();
  };
