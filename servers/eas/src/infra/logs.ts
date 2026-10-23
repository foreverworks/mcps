import type { HttpRequest } from "@foreverworks/mcp-kit";

import type { LogPort } from "../app/ports.js";

/**
 * Log files: signed Cloud Storage URLs that EAS hands out with a build, a job
 * or a submission (storage.googleapis.com). They need no token, so none is
 * sent: an Expo token has no business reaching another host. They arrive
 * brotli-compressed with `content-encoding: br`, which fetch decodes.
 */
export const makeLogs = (http: HttpRequest): LogPort => ({
  read: (url) => http<string>(url, { as: "text" }),
});
