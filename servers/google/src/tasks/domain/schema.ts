/**
 * Google Tasks' wire shapes, written from the API's Discovery document
 * (tasks v1, revision 20261020) rather than generated: the few fields this
 * server reads, every one optional because that is what the schema promises.
 */
export type RawTaskList = {
  readonly id?: string | null;
  readonly title?: string | null;
  readonly updated?: string | null;
};

export type RawTask = {
  readonly id?: string | null;
  readonly title?: string | null;
  readonly notes?: string | null;
  /** "needsAction" or "completed". */
  readonly status?: string | null;
  /** RFC 3339 at midnight UTC: Tasks keeps only the date. */
  readonly due?: string | null;
  readonly completed?: string | null;
  readonly parent?: string | null;
  readonly position?: string | null;
  readonly updated?: string | null;
  readonly webViewLink?: string | null;
  readonly deleted?: boolean | null;
  readonly hidden?: boolean | null;
};

export type Page<T> = { readonly items?: readonly T[] | null; readonly nextPageToken?: string | null };
