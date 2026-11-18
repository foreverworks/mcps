import type { Cookie } from "../../domain/login.js";
import { type AppError, fail, loginRefused } from "../../domain/errors.js";
import { absorbCookies, cookieHeader } from "./cookies.js";
import { type KeycloakPage, keycloakPage } from "./keycloakPage.js";

/**
 * Keycloak's own login form, filled the way a browser fills it, without one:
 * the authorize URL, the user name and password posted to the page's
 * `loginAction`, then the authenticator's code to the next page's. Keycloak
 * answers the last post with a 302 to the redirect URI carrying `code`, which
 * the caller exchanges with its PKCE verifier like any browser sign-in.
 *
 * Every page is read from its `kcContext` (keycloakPage.ts). A page that
 * comes back with an error banner is the form refusing what was sent:
 * `login_refused`, with Keycloak's own words, and never sent again by itself
 * (the grant pauses it). A step this server cannot take (a new password,
 * terms to accept, a second factor to enrol) is refused the same way, naming
 * the step, since the person has to finish it once on the portal.
 *
 * Only GETs are re-sent after a dropped connection: a password posted twice
 * counts twice toward Keycloak's lockout.
 */
export type FormStep =
  | { readonly kind: "code"; readonly code: string; readonly state: string | undefined }
  | { readonly kind: "needs_code"; readonly action: string; readonly cookies: readonly Cookie[] };

export type FormOptions = {
  readonly fetch: typeof fetch;
  /** Where Keycloak sends the browser at the end; the walk stops at the first redirect there. */
  readonly redirectUri: string;
  readonly timeoutMs?: number;
};

type Hop = { readonly url: string; readonly status: number; readonly location: string | undefined; readonly body: string; readonly jar: readonly Cookie[] };

/** A browser's headers: the edge in front of Keycloak turns away clients that look like scripts. */
const HEADERS = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "ro-RO,ro;q=0.9,en;q=0.5",
};

const dropped = (thrown: unknown): boolean => {
  const code = (thrown as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  return code === "UND_ERR_SOCKET" || code === "ECONNRESET";
};

const unreachable = (url: string, thrown: unknown): AppError => ({
  kind: "api",
  status: 0,
  message: `${new URL(url).host}: ${thrown instanceof Error ? thrown.message : String(thrown)}`.slice(0, 300),
});

export const makePasswordForm = (options: FormOptions) => {
  const { redirectUri } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const hit = async (jar: readonly Cookie[], url: string, form?: Readonly<Record<string, string>>, referer?: string): Promise<Hop> => {
    const target = new URL(url);
    const headers: Record<string, string> = { ...HEADERS };
    const cookie = cookieHeader(jar, target);
    if (cookie !== "") headers["cookie"] = cookie;
    if (referer !== undefined) headers["referer"] = referer;
    if (form !== undefined) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      headers["origin"] = target.origin;
    }
    const send = () =>
      options.fetch(url, {
        method: form === undefined ? "GET" : "POST",
        headers,
        ...(form === undefined ? {} : { body: new URLSearchParams(form).toString() }),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    const response = await send().catch((thrown: unknown) => (form === undefined && dropped(thrown) ? send() : Promise.reject(thrown))).catch((thrown: unknown) => fail(unreachable(url, thrown)));
    const location = response.headers.get("location");
    return {
      url,
      status: response.status,
      location: location === null ? undefined : new URL(location, url).toString(),
      body: await response.text(),
      jar: absorbCookies(jar, target, response.headers.getSetCookie()),
    };
  };

  /** Follow redirects until a page, or a redirect to the redirect URI (which is never fetched: the code in it is the prize). */
  const follow = async (first: Hop): Promise<Hop> => {
    let hop = first;
    for (let i = 0; i < 15; i++) {
      if (hop.status < 300 || hop.status >= 400 || hop.location === undefined || hop.location.startsWith(redirectUri)) return hop;
      hop = await hit(hop.jar, hop.location, undefined, hop.url);
    }
    return fail({ kind: "api", status: hop.status, message: "Keycloak redirected more than 15 times" });
  };

  /** What a page that is not the end means: the code step, a refusal in Keycloak's words, or a step this server cannot take. */
  const stepOf = (hop: Hop, after: "password" | "code"): FormStep => {
    if (hop.location?.startsWith(redirectUri)) {
      const landed = new URL(hop.location);
      const code = landed.searchParams.get("code");
      if (code !== null && code !== "") return { kind: "code", code, state: landed.searchParams.get("state") ?? undefined };
      const error = landed.searchParams.get("error");
      return fail(loginRefused(`Keycloak ended the sign-in with ${error ?? "no code"}${landed.searchParams.get("error_description") ? `: ${landed.searchParams.get("error_description")}` : ""}`));
    }
    if (hop.status >= 500) return fail({ kind: "api", status: hop.status, message: `Keycloak answered ${hop.status}` });
    const page: KeycloakPage = keycloakPage(hop.body);
    if (page.message !== undefined && page.message.type === "error") return fail(loginRefused(`Keycloak: ${page.message.summary}`));
    if (page.pageId === "login-otp" && page.loginAction !== undefined) {
      if (after === "code") return fail(loginRefused("Keycloak asked for the authenticator code again without saying why"));
      return { kind: "needs_code", action: page.loginAction, cookies: hop.jar };
    }
    if (page.pageId === "login" && after === "password") return fail(loginRefused("Keycloak showed the password form again without saying why"));
    if (page.pageId === undefined) return fail({ kind: "drift", message: `the sign-in page (${hop.status}) is not a Keycloak page this server knows: no kcContext pageId` });
    return fail(loginRefused(`Keycloak asks for a step this server cannot take ("${page.pageId}"); sign in once on the portal to finish it`));
  };

  return {
    /** From the authorize URL to the end (a code) or to the authenticator step. */
    start: async (authorizeUrl: string, credentials: { readonly username: string; readonly password: string }): Promise<FormStep> => {
      const page = await follow(await hit([], authorizeUrl));
      if (page.location?.startsWith(redirectUri)) return stepOf(page, "password");
      const form = keycloakPage(page.body);
      if (form.pageId !== "login" || form.loginAction === undefined) {
        return fail({ kind: "drift", message: `Keycloak's first page is "${form.pageId ?? "(none)"}", not its login form` });
      }
      const after = await hit(page.jar, form.loginAction, { username: credentials.username, password: credentials.password, credentialId: "" }, page.url);
      return stepOf(await follow(after), "password");
    },
    /** The authenticator's code on the page that asked for it. */
    submitCode: async (pending: { readonly action: string; readonly cookies: readonly Cookie[] }, otp: string): Promise<FormStep> => {
      const after = await hit(pending.cookies, pending.action, { otp, login: "Sign In" });
      return stepOf(await follow(after), "code");
    },
  };
};

export type PasswordForm = ReturnType<typeof makePasswordForm>;
