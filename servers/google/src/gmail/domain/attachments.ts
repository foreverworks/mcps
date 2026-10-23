import { type MimePart, walkParts } from "./mime.js";

export type Attachment = {
  readonly filename: string;
  readonly mimeType: string | undefined;
  readonly attachmentId: string;
  readonly size: number | undefined;
};

/**
 * Real attachments only.
 *
 * The filename test is load-bearing: Gmail also hands out an attachmentId for
 * large INLINE parts (a long text/html body gets one), and counting those would
 * report every newsletter as carrying an attachment.
 */
export const attachmentsOf = (payload: MimePart): readonly Attachment[] =>
  [...walkParts(payload)].flatMap((part) => {
    const id = part.body?.attachmentId;
    return part.filename && id
      ? [{ filename: part.filename, mimeType: part.mimeType ?? undefined, attachmentId: id, size: part.body?.size ?? undefined }]
      : [];
  });
