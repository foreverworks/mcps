import { fail, inputError } from "./errors.js";

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** What a bare code can look like: URL-safe characters and nothing else. */
const BARE_CODE = /^[A-Za-z0-9._~-]+$/;

const parseUrl = (value: string): URL => {
  try {
    return new URL(value);
  } catch {
    return fail(inputError(`"${value}" is not a URL; paste the whole address bar, including the scheme`));
  }
};

/**
 * The code from a redirect's query string, or a sentence saying why not.
 *
 * The operator pastes this by hand, so every plausible way it arrives wrong gets
 * its own sentence. "No code parameter found" on a URL that clearly failed SCA
 * sends someone back to the browser to repeat a flow that will fail again.
 */
const codeFromQuery = (query: URLSearchParams): string => {
  const denial = query.get("error");
  if (denial !== null) {
    const detail = query.get("error_description");
    fail(inputError(`the bank refused the consent: ${denial}${detail === null ? "" : ` (${detail})`}`));
  }
  const code = query.get("code")?.trim() ?? "";
  if (code === "")
    fail(
      inputError(
        "no code parameter there. It has to be the address the bank redirected to AFTER the app " +
          "approval, not the authorization URL start_auth handed out",
      ),
    );
  return code;
};

/**
 * The authorization code, from whatever the operator pasted: the whole redirect
 * URL (what the browser's address bar shows), its query string (`code=...&state=...`),
 * or the bare code value, which is what a phone's share sheet tends to leave
 * behind.
 */
export const authorizationCode = (input: string): string => {
  const trimmed = input.trim();
  if (trimmed === "") return fail(inputError("empty: paste the redirect URL the bank sent you to, or its code value"));
  if (SCHEME.test(trimmed)) return codeFromQuery(parseUrl(trimmed).searchParams);
  if (trimmed.includes("=")) return codeFromQuery(new URLSearchParams(trimmed.slice(trimmed.indexOf("?") + 1)));
  if (!BARE_CODE.test(trimmed))
    return fail(inputError(`"${trimmed}" is neither a redirect URL nor a code; paste the whole address bar`));
  return trimmed;
};
