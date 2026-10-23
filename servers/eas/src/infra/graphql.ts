import type { HttpRequest } from "@foreverworks/mcp-kit";

import { fail } from "../domain/errors.js";
import { graphqlFailure, type GraphqlError } from "./graphqlErrors.js";

/** EAS's one endpoint. EXPO_API_URL may point elsewhere (a staging server); nothing else is configurable. */
export const API = "https://api.expo.dev/graphql";

export type Graphql = {
  readonly query: <T>(document: string, variables?: Readonly<Record<string, unknown>>) => Promise<T>;
  readonly mutate: <T>(document: string, variables?: Readonly<Record<string, unknown>>) => Promise<T>;
};

type Answer = { readonly data?: unknown; readonly errors?: readonly GraphqlError[] };

export const makeGraphql = (http: HttpRequest, endpoint: string = API): Graphql => {
  const send = async <T>(document: string, variables: Readonly<Record<string, unknown>>, mutation: boolean): Promise<T> => {
    const answer = await http<Answer | undefined>(endpoint, { method: "POST", json: { query: document, variables }, idempotent: !mutation });
    if (answer?.errors !== undefined && answer.errors.length > 0) return fail(graphqlFailure(answer.errors, { mutation }));
    if (answer?.data === undefined || answer.data === null) return fail({ kind: "drift", message: "EAS answered with neither data nor errors" });
    return answer.data as T;
  };
  return {
    query: (document, variables = {}) => send(document, variables, false),
    mutate: (document, variables = {}) => send(document, variables, true),
  };
};
