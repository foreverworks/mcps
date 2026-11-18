import type { Cookie } from "../../domain/login.js";

/**
 * The few cookie rules a sign-in form needs, and no more: Keycloak keeps its
 * half-finished login in cookies scoped to the realm's path (AUTH_SESSION_ID,
 * KC_RESTART), and the edge in front of it adds its own (an F5 `TS…` and the
 * portal's ESM_COOKIE). Domain and path matching as RFC 6265 has them; no
 * expiry clock, since a jar lives one sign-in. Pure.
 */
export const cookieHeader = (jar: readonly Cookie[], url: URL): string =>
  jar
    .filter((c) => (c.hostOnly ? url.hostname === c.domain : url.hostname === c.domain || url.hostname.endsWith(`.${c.domain}`)) && url.pathname.startsWith(c.path))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

/** The jar after an answer's Set-Cookie headers: a cookie replaced by name, domain and path, dropped when the answer expires it. */
export const absorbCookies = (jar: readonly Cookie[], url: URL, setCookies: readonly string[]): readonly Cookie[] => {
  let next = [...jar];
  for (const raw of setCookies) {
    const [pair = "", ...attributes] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    let domain = url.hostname;
    let hostOnly = true;
    let path = "/";
    let expired = value === "" || value === '""';
    for (const attribute of attributes) {
      const at = attribute.indexOf("=");
      const key = (at < 0 ? attribute : attribute.slice(0, at)).trim().toLowerCase();
      const v = at < 0 ? "" : attribute.slice(at + 1).trim();
      if (key === "domain" && v !== "") {
        domain = v.replace(/^\./, "").toLowerCase();
        hostOnly = false;
      }
      if (key === "path" && v.startsWith("/")) path = v;
      if (key === "max-age" && Number(v) <= 0) expired = true;
      if (key === "expires" && Date.parse(v) < Date.parse("2000-01-01")) expired = true;
    }
    next = next.filter((c) => !(c.name === name && c.domain === domain && c.path === path));
    if (!expired) next.push({ name, value, domain, hostOnly, path });
  }
  return next;
};
