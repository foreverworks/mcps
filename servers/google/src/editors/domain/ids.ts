import { driveId } from "../../drive/domain/path.js";

/**
 * A file id from whatever the caller pasted: the id itself, or the URL a
 * Doc, Sheet or deck opens at (`.../d/<id>/edit`). Anything else fails as
 * input before a request is made. Pure.
 */
export const fileIdFrom = (input: string): string => driveId(/\/d\/([A-Za-z0-9_-]+)/.exec(input)?.[1] ?? input.trim(), "file id or file link");
