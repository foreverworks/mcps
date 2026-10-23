import { targetId } from "../../../drive/app/usecases/browse.js";
import { shape, SPREADSHEET_MIME } from "../../../drive/domain/entries.js";
import { finishCreated } from "../../../editors/app/created.js";
import { layoutRequests, type SheetSpec } from "../../domain/layout.js";
import { pickSheet, sheetLink, sheetSummary } from "../../domain/spreadsheet.js";
import type { Deps } from "../ports.js";

/**
 * A new spreadsheet: made by Drive directly in its folder (the Drive product's
 * own create, no move), then its sheets and header rows laid out in one batch.
 */
export const createSpreadsheet = async (
  deps: Deps,
  args: { readonly title: string; readonly sheets: readonly SheetSpec[]; readonly folderId: string; readonly folderPath: string },
) => {
  const parentId = await targetId(deps.drive, args.folderId, args.folderPath);
  const made = shape(await deps.drive.drive.createFile(args.title, SPREADSHEET_MIME, parentId));
  const link = made.link ?? sheetLink(made.id);
  return finishCreated({ id: made.id, link }, "spreadsheet", async () => {
    if (args.sheets.length > 0) {
      const first = sheetSummary(pickSheet(await deps.sheets.metadata(made.id), ""));
      await deps.sheets.batchUpdate(made.id, layoutRequests(first.sheetId, args.sheets));
    }
    return { spreadsheetId: made.id, title: made.name, link, sheets: args.sheets.map((s) => s.title) };
  });
};
