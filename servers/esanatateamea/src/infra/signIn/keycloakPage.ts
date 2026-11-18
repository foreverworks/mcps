/**
 * What a Keycloak login page asks for. eSănătateaMea's theme is a
 * Keycloakify one: the page carries no `<form>` or `<input>` at all, only a
 * script that declares `kcContext`, a JSON-like object the theme renders in
 * the browser. Its `pageId` names the step ("login", "login-otp", or one this
 * server cannot take, such as "login-update-password"), `loginAction` is
 * where the step's form posts, and `message` is what the page would show in
 * its banner ("Invalid username or password.", "Invalid authenticator code.").
 * Pure.
 */
export type KeycloakPage = {
  readonly pageId: string | undefined;
  readonly loginAction: string | undefined;
  readonly message: { readonly type: string; readonly summary: string } | undefined;
};

/** A JavaScript string literal's body, unescaped (`\/` and `&` are what the theme writes). */
const unescaped = (raw: string): string => {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\\//g, "/");
  }
};

const STRING = String.raw`"((?:[^"\\]|\\.)*)"`;

const stringField = (text: string, key: string): string | undefined => {
  const match = new RegExp(String.raw`"${key}"\s*:\s*${STRING}`).exec(text);
  return match?.[1] === undefined ? undefined : unescaped(match[1]);
};

export const keycloakPage = (html: string): KeycloakPage => {
  const block = /"message"\s*:\s*\{([^{}]*)\}/.exec(html)?.[1];
  const summary = block === undefined ? undefined : stringField(block, "summary");
  return {
    pageId: stringField(html, "pageId"),
    loginAction: stringField(html, "loginAction"),
    message: summary === undefined ? undefined : { type: stringField(block ?? "", "type") ?? "error", summary },
  };
};
