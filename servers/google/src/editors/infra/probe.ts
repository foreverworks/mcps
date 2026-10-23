import type { EditorApi } from "../app/ports.js";
import { asAppError } from "../domain/errors.js";
import type { Request } from "../../infra/httpJson.js";

/**
 * An id no file has. Asking an API about it costs one read and proves the API
 * answers: a 404 (or a 400 for an id it will not parse) comes from the API
 * itself, while a project that never enabled it refuses with a 403 first.
 */
const NO_SUCH_FILE = "mcp-google-health-probe-no-such-file";

const PROBES: Readonly<Record<EditorApi, { readonly url: string; readonly fields: string }>> = {
  docs: { url: `https://docs.googleapis.com/v1/documents/${NO_SUCH_FILE}`, fields: "documentId" },
  sheets: { url: `https://sheets.googleapis.com/v4/spreadsheets/${NO_SUCH_FILE}`, fields: "spreadsheetId" },
  slides: { url: `https://slides.googleapis.com/v1/presentations/${NO_SUCH_FILE}`, fields: "presentationId" },
};

export const makeProbe =
  (requestFor: (api: EditorApi) => Request) =>
  async (api: EditorApi): Promise<void> => {
    const { url, fields } = PROBES[api];
    try {
      await requestFor(api)(url, { query: { fields } });
    } catch (thrown) {
      const error = asAppError(thrown);
      if (error?.kind === "api" && (error.status === 404 || error.status === 400)) return;
      throw thrown;
    }
  };
