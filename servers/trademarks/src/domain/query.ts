import type { MatchMode, Office, StatusFilter } from "./mark.js";

/** What a caller asked for. */
export type SearchQuery = {
  readonly name: string;
  /** Empty: every office. */
  readonly offices: readonly Office[];
  /** Nice classes, 1 to 45; empty: every class. */
  readonly classes: readonly number[];
  readonly match: MatchMode;
  readonly status: StatusFilter;
  /** Words that must appear together in a mark's goods and services, where the office's source can filter on them. */
  readonly goods?: string | undefined;
  /** Marks listed per office. */
  readonly limit: number;
};

/** What one register is asked: the same question without the office list or the listing limit. */
export type SourceQuery = Pick<SearchQuery, "name" | "classes" | "match" | "status" | "goods">;
