import { makeErrorKit } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts).
 */
export type AppError =
  /** A setting is missing or unusable (the database, a model endpoint, a root); nothing was done. */
  | { readonly kind: "config"; readonly variable?: string; readonly message: string }
  /** The request cannot be answered as asked: a local check names what is wrong. */
  | { readonly kind: "input"; readonly message: string }
  /** No such collection, source or passage. */
  | { readonly kind: "not_found"; readonly message: string }
  /** The database refused or could not be reached. */
  | { readonly kind: "database"; readonly message: string; readonly code?: string }
  /** The embedding or rerank endpoint failed or answered in a shape this server does not know. */
  | { readonly kind: "model"; readonly endpoint: "embed" | "rerank"; readonly message: string; readonly status?: number }
  /**
   * A remote embedding provider refused or failed. `reason` says whether waiting helps: `quota` (its
   * allowance is spent until it resets), `auth` (the token was refused), `rate_limited` (still
   * limited after every retry), `unreachable`, or `rejected` (it refused this request's texts).
   */
  | { readonly kind: "provider"; readonly provider: string; readonly reason: "quota" | "auth" | "rate_limited" | "unreachable" | "rejected"; readonly message: string; readonly status?: number }
  /** A text extractor (pdftotext, ocrmypdf, tesseract, pandoc) is missing or failed on a file. */
  | { readonly kind: "extract"; readonly tool: string; readonly message: string }
  /** The collection was built with another embedding model or dimension than the server uses now. */
  | { readonly kind: "mismatch"; readonly message: string };

export const configError = (message: string, variable?: string): AppError =>
  variable === undefined ? { kind: "config", message } : { kind: "config", variable, message };
export const inputError = (message: string): AppError => ({ kind: "input", message });
export const notFound = (message: string): AppError => ({ kind: "not_found", message });

export const { fail, asAppError } = makeErrorKit<AppError>("rag");

/** One line for a failure inside a reply that goes on: ours by kind, anything else by its message. */
export const describeFailure = (thrown: unknown): string => {
  const e = asAppError(thrown);
  if (e !== undefined) return `${e.kind}: ${e.message}`;
  return thrown instanceof Error ? thrown.message : String(thrown);
};

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return error.variable === undefined
        ? "fix the setting the message names, then call health"
        : `set ${error.variable} (the README's Configuration section says what it takes), then call health`;
    case "input":
      return "fix what the message names and call again";
    case "not_found":
      return "list_collections and list_sources say what exists";
    case "database":
      return "call health; if the database is reachable, the message is Postgres's own and names what it refused";
    case "model":
      return `call health: it says whether the ${error.endpoint} endpoint answers and which model it serves`;
    case "provider":
      switch (error.reason) {
        case "quota":
          return `${error.provider}'s allowance is spent until it resets; index with the local provider meanwhile (create_collection with embedding_provider local), or raise the allowance`;
        case "auth":
          return `${error.provider} refused the token: it must allow running its embedding model on that account; health says what is configured`;
        default:
          return `call index_path again later, or switch the collection to the local provider; files already indexed are passed over`;
      }
    case "extract":
      return `call health for the extractors this server found; ${error.tool} must be installed and on PATH, and the file must be one it can read`;
    case "mismatch":
      return "search and index a collection with the model it was built with, or drop it and index its sources again";
  }
};
