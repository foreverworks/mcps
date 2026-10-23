/**
 * The Meet REST API's wire shapes, written from its Discovery document (meet
 * v2, revision 20261019): the fields this server reads, every one optional.
 */
export type RawConferenceRecord = {
  readonly name?: string | null;
  readonly startTime?: string | null;
  readonly endTime?: string | null;
  readonly expireTime?: string | null;
  readonly space?: string | null;
};

/** Where a transcript or smart notes are saved: a Google Doc. */
export type RawDocsDestination = { readonly document?: string | null; readonly exportUri?: string | null };

export type RawTranscript = {
  readonly name?: string | null;
  /** STARTED, ENDED or FILE_GENERATED. */
  readonly state?: string | null;
  readonly startTime?: string | null;
  readonly endTime?: string | null;
  readonly docsDestination?: RawDocsDestination | null;
};

export type RawSmartNote = RawTranscript;

export type RawRecording = {
  readonly name?: string | null;
  readonly state?: string | null;
  readonly startTime?: string | null;
  readonly endTime?: string | null;
  readonly driveDestination?: { readonly file?: string | null; readonly exportUri?: string | null } | null;
};

export type RawParticipant = {
  readonly name?: string | null;
  readonly signedinUser?: { readonly user?: string | null; readonly displayName?: string | null } | null;
  readonly anonymousUser?: { readonly displayName?: string | null } | null;
  readonly phoneUser?: { readonly displayName?: string | null } | null;
};

export type RawTranscriptEntry = {
  readonly name?: string | null;
  readonly participant?: string | null;
  readonly text?: string | null;
  readonly languageCode?: string | null;
  readonly startTime?: string | null;
  readonly endTime?: string | null;
};

export type Page<K extends string, T> = { readonly [key in K]?: readonly T[] | null } & { readonly nextPageToken?: string | null };
