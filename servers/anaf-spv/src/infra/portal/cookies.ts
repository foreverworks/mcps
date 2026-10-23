import type { SessionStore } from "../../app/ports.js";
import { fail, sessionExpired } from "../../domain/errors.js";
import { atSignIn, type Browser, type Page, type Request } from "../browser.js";
import type { Exclusive } from "../store.js";

export type Go = (path: string, request?: Request) => Promise<Page>;

/**
 * Pages behind a stored session: `fn` runs with the stored cookies, one
 * operation at a time (`exclusive`), and what the site set is stored after.
 * A page at the sign-in form is a dead session (`session_expired`), which the
 * use cases answer by signing in once and calling again.
 */
export const makeCookieRunner =
  (browser: Browser, store: SessionStore, now: () => number, exclusive: Exclusive) =>
  <T>(fn: (go: Go) => Promise<T>): Promise<T> =>
    exclusive(async () => {
      const session = (await store.read()) ?? fail(sessionExpired("no session is stored"));
      let cookies = session.cookies;
      const go: Go = async (path, request) => {
        const page = await browser.go(cookies, path, request);
        cookies = page.cookies;
        if (atSignIn(page)) fail(sessionExpired(`${new URL(browser.origin).host} sent ${path} to its sign-in form: the session ended`));
        return page;
      };
      const value = await fn(go);
      await store.write({ ...session, cookies, lastOkAtMs: now() });
      return value;
    });
