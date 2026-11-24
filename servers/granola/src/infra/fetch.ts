/** A fetch that never follows a redirect: a token, a code or a bearer header is sent where it was meant to go and nowhere else. */
export const refusingRedirects =
  (fetchImpl: typeof fetch): typeof fetch =>
  (input, init) =>
    fetchImpl(input, { ...init, redirect: "error" });
