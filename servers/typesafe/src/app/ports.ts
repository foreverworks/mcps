/**
 * What the use cases need, stated as functions. infra/ satisfies them; nothing
 * in app/ or domain/ imports from infra/.
 */
import type { InputFiles } from "@foreverworks/mcp-kit";

import type { AskRequest, AskResult, ModelCard } from "../domain/schema.js";

export type SystemOnePort = {
  /** One state, many questions, one round trip. */
  readonly ask: (request: AskRequest) => Promise<AskResult>;
  readonly models: () => Promise<readonly ModelCard[]>;
};

/** A file as written: where, and what, so a reader can check it is the same bytes. */
export type Saved = { readonly path: string; readonly sha256: string; readonly size: number };

export type OutboxPort = {
  /** Writes the file whole into the outbox. */
  readonly save: (name: string, text: string) => Promise<Saved>;
};

export type Deps = {
  readonly systemOne: SystemOnePort;
  readonly outbox: OutboxPort;
  /** The kit's input-file reader: a batch's rows from a file, by path or by checked base64. */
  readonly readInput: InputFiles;
  /** The model a call uses when it names none (`jev-latest` unless TYPESAFE_MODEL says otherwise). */
  readonly defaultModel: string;
  /** Where requests go, named in health; the port already knows it. */
  readonly baseUrl: string;
  readonly now: () => number;
};
