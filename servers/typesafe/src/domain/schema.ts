/**
 * TypeSafe's wire shapes, as its own SDK declares them (`@typesafe-ai/sdk`).
 * Types only: nothing of the package runs here; the requests go through the
 * kit's HTTP client (infra/typesafeApi.ts), which checks every answer against
 * these shapes before anything above it reads one.
 */
import type {
  BoxQuestion,
  ChoiceResponse,
  EntryType,
  ModelCard,
  NoulResponse,
  Question as SdkQuestion,
  ScoreResponse,
  SystemOneRequest,
  Usage,
} from "@typesafe-ai/sdk";

export type { EntryType, ModelCard, Usage };

/** The questions this server asks: the SDK's, less `box` (see AskRequest). */
export type Question = Exclude<SdkQuestion, BoxQuestion>;
export type Questions = { readonly [id: string]: Question };

/** What is judged: an entry, but never null (the API answers a null state as a missing one). */
export type State = SystemOneRequest["state"];

/**
 * A Score as answered. Its legend only echoes the caller's own levels, so it stays plain JSON here:
 * since 0.7 the SDK types it through a recursive asset-aware mapping too deep for tsc to check a literal against.
 */
export type ScoreAnswer = Omit<ScoreResponse, "legend"> & { readonly legend: Readonly<Record<string, unknown>> };

export type Answer = NoulResponse | ChoiceResponse | ScoreAnswer;

/**
 * `POST /v1/systemone`: one state, the questions keyed by the caller's ids, the model resolved.
 * Without `assets`: images and `box` questions are TypeSafe's opt-in experiment
 * (`TypeSafe-Danger-Zone-Images`), not something this server offers.
 */
export type AskRequest = Omit<SystemOneRequest, "model" | "assets" | "questions"> & { readonly questions: Questions; readonly model: string };

export type AskResult = {
  readonly model: string;
  readonly answers: Readonly<Record<string, Answer>>;
  readonly usage: Usage;
};
