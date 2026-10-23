import { type ErrorKit, makeErrorKit } from "@foreverworks/mcp-kit";

/**
 * The failures every receipts server raises the same way, with the same remedy.
 *
 * A server's own failures (a refused token, an API that answered no) stay in
 * that server, in its own error-kit namespace, because their remedies name its
 * app. These three do not: a bad argument, an unknown order id and a missing
 * credentials file mean the same thing and are fixed the same way in bolt-food
 * and glovo alike, which is what makes one namespace for them safe even with
 * both servers in one process.
 */
export type CommonError =
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "input"; readonly message: string }
  | { readonly kind: "config"; readonly message: string };

export const notFound = (message: string): CommonError => ({ kind: "not_found", message });
export const inputError = (message: string): CommonError => ({ kind: "input", message });
export const configError = (message: string): CommonError => ({ kind: "config", message });

const common = makeErrorKit<CommonError>("receipts");

export const { fail } = common;

const COMMON_KINDS: ReadonlySet<string> = new Set<CommonError["kind"]>(["not_found", "input", "config"]);

export const isCommon = (error: { readonly kind: string }): error is CommonError => COMMON_KINDS.has(error.kind);

/**
 * A server's own error kit joined with the common one: one `fail` and one
 * `asAppError` that cover both, so no caller has to know which namespace a
 * failure lives in.
 */
export const joinErrors = <E extends { readonly kind: string }>(own: ErrorKit<E>): ErrorKit<E | CommonError> => ({
  fail: (error) => (isCommon(error) ? common.fail(error) : own.fail(error as E)),
  asAppError: (thrown) => own.asAppError(thrown) ?? common.asAppError(thrown),
});

/** What the operator should do about a common failure, in one sentence. */
export const commonRemedy = (error: CommonError): string => {
  switch (error.kind) {
    case "config":
      return "write the credentials file the server's README describes (Configuration) and point the server's _CREDS variable at it";
    case "not_found":
      return "check the id against list_orders";
    case "input":
      return "fix the arguments and call again";
  }
};
