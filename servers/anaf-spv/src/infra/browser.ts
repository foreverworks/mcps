import { fail } from "../domain/errors.js";
import type { Cookies } from "../domain/session.js";

/**
 * A browser just big enough for SPV: one host, cookies, redirects followed by
 * hand, no JavaScript. Everything SPV does in the page's script is replayed
 * here as the form posts it sends (measured: the sign-in, the
 * message list, a download and a request each work with no script at all).
 *
 * Cookies are kept by name with their path, because SPV sets one under
 * /SNMD; a session is nothing but these cookies (F5's MRHSession and
 * LastMRH_Session, WebSphere's LtpaToken2 and JSESSIONID).
 */

/** A cookie as stored: `value` or `value; path=/SNMD` when its path is not `/`. */
type Jar = Map<string, { readonly value: string; readonly path: string }>;

const jarOf = (cookies: Cookies): Jar =>
  new Map(
    Object.entries(cookies).map(([name, stored]) => {
      const [value = "", path = "/"] = stored.split("; path=");
      return [name, { value, path }];
    }),
  );

const cookiesOf = (jar: Jar): Cookies => Object.fromEntries([...jar].map(([name, c]) => [name, c.path === "/" ? c.value : `${c.value}; path=${c.path}`]));

const headerFor = (jar: Jar, path: string): string =>
  [...jar]
    .filter(([, c]) => path === c.path || path.startsWith(c.path.endsWith("/") ? c.path : `${c.path}/`))
    .map(([name, c]) => `${name}=${c.value}`)
    .join("; ");

/** Apply one Set-Cookie header: store it, or drop it when SPV expires or deletes it. */
const absorb = (jar: Jar, header: string): void => {
  const [pair = "", ...attributes] = header.split(";");
  const eq = pair.indexOf("=");
  if (eq <= 0) return;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const attr = (key: string) => attributes.map((a) => a.trim()).find((a) => a.toLowerCase().startsWith(`${key}=`))?.slice(key.length + 1);
  const expires = attr("expires");
  const maxAge = attr("max-age");
  const gone = value === "" || value === "deleted" || maxAge === "0" || (expires !== undefined && Date.parse(expires) < Date.now());
  if (gone) jar.delete(name);
  else jar.set(name, { value, path: attr("path") ?? "/" });
};

export type Hop = { readonly method: string; readonly url: string; readonly status: number };

export type Page = {
  /** The address the last hop answered from. */
  readonly url: URL;
  readonly status: number;
  readonly headers: Headers;
  readonly bytes: Uint8Array;
  readonly cookies: Cookies;
  readonly hops: readonly Hop[];
};

export const textOf = (page: Page): string => new TextDecoder("utf-8").decode(page.bytes);

export type BrowserOptions = {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly userAgent?: string;
};

export type Request = {
  readonly method?: "GET" | "POST";
  readonly body?: URLSearchParams | FormData;
  readonly headers?: Readonly<Record<string, string>>;
};

const MAX_HOPS = 10;

/** A page SPV failed to serve: status 0 is no connection, 5xx a failure on its side. */
const unreachable = (url: string, cause: unknown): never =>
  fail({ kind: "api", status: 0, message: `${new URL(url).host} did not answer (${cause instanceof Error ? cause.message : String(cause)})` });

export const makeBrowser = (origin: string, options: BrowserOptions = {}) => {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const userAgent = options.userAgent ?? "Mozilla/5.0 (X11; Linux x86_64) mcp-anaf-spv";

  /**
   * Load `path` (relative to the portal) with these cookies, following
   * redirects as a browser does (a POST answered with 302 continues as GET).
   * Answers the last page and the cookies it ended with.
   */
  const go = async (cookies: Cookies, path: string, request: Request = {}): Promise<Page> => {
    const doFetch = options.fetch ?? globalThis.fetch;
    const jar = jarOf(cookies);
    const hops: Hop[] = [];
    let url = new URL(path, origin);
    let method = request.method ?? "GET";
    let body: URLSearchParams | FormData | undefined = request.body;
    for (;;) {
      const response = await doFetch(url, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": userAgent, "accept-language": "ro-RO,ro;q=0.9,en;q=0.5", cookie: headerFor(jar, url.pathname), ...(method === "POST" ? request.headers : {}) },
        ...(body === undefined ? {} : { body }),
      }).catch((cause: unknown) => unreachable(url.toString(), cause));
      for (const header of response.headers.getSetCookie()) absorb(jar, header);
      hops.push({ method, url: url.toString(), status: response.status });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location !== null) {
        await response.arrayBuffer().catch(() => undefined);
        if (hops.length >= MAX_HOPS) fail({ kind: "drift", message: `SPV redirected more than ${MAX_HOPS} times from ${path}` });
        url = new URL(location, url);
        if (url.origin !== new URL(origin).origin) fail({ kind: "drift", message: `SPV redirected to another site (${url.host})` });
        method = "GET";
        body = undefined;
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer().catch((cause: unknown) => unreachable(url.toString(), cause)));
      if (response.status >= 500) fail({ kind: "api", status: response.status, message: `SPV answered ${response.status} for ${url.pathname}` });
      return { url, status: response.status, headers: response.headers, bytes, cookies: cookiesOf(jar), hops };
    }
  };

  return { origin, go };
};

export type Browser = ReturnType<typeof makeBrowser>;

/** SPV's sign-in form lives at /my.policy; every page behind the session sends a stranger there. */
export const atSignIn = (page: Page): boolean => page.url.pathname === "/my.policy" || page.hops.some((h) => new URL(h.url).pathname === "/my.policy");
