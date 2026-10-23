import type { SlidesPort } from "../app/ports.js";
import type { RawBatchUpdateResponse, RawPresentation, RawThumbnail } from "../domain/schema.js";
import type { Request } from "../../infra/httpJson.js";

const SLIDES = "https://slides.googleapis.com/v1/presentations";

const presentationUrl = (id: string): string => `${SLIDES}/${encodeURIComponent(id)}`;

/**
 * The Slides REST API. The presentation is read whole unless a field mask is
 * given: layouts, slides and notes pages are nested several levels deep and a
 * mask for all of them would be longer than it saves. A batchUpdate is a POST
 * and so is never retried after a 5xx or a lost answer (httpJson).
 */
export const makeSlidesApi = (request: Request): SlidesPort => {
  const apply: SlidesPort["apply"] = (id, requests, revisionId) =>
    request<RawBatchUpdateResponse>(`${presentationUrl(id)}:batchUpdate`, {
      method: "POST",
      json: { requests, ...(revisionId ? { writeControl: { requiredRevisionId: revisionId } } : {}) },
    });
  return {
    get: (id, fields) => request<RawPresentation>(presentationUrl(id), fields ? { query: { fields } } : {}),
    batchUpdate: apply,
    apply,
    thumbnail: (id, pageId, size) =>
      request<RawThumbnail>(`${presentationUrl(id)}/pages/${encodeURIComponent(pageId)}/thumbnail`, {
        query: { "thumbnailProperties.mimeType": "PNG", "thumbnailProperties.thumbnailSize": size },
      }),
  };
};
