/**
 * Live smoke test for the full Docs, Sheets and Slides APIs: drives the server
 * as a real MCP client would, the running service when MCP_URL is set
 * (mcp-kit connectSmoke), else the built one over stdio. Needs the Drive grant
 * (or SMOKE_ACCOUNT's) and the three APIs enabled; everything in test/ does not.
 *
 *   npm run build && npx tsx scripts/smoke-editors-api.ts
 *
 * It WRITES, on that account's Drive only: a scratch folder holding one
 * document, one spreadsheet and one deck, built through the batch tools and
 * read back, then all trashed. On the document it also comments, shares with
 * anyone holding the link and takes that back, and saves an old revision.
 *
 * SMOKE_IMAGE: a PNG the server can read (a path in its file roots, as
 * upload_file takes it), to insert into the document and the deck. Unset: the
 * image checks are skipped.
 */
import { smoke } from "./smokeClient.js";

const image = process.env["SMOKE_IMAGE"] ?? "";

const check = (what: string, ok: boolean): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) throw new Error(`check failed: ${what}`);
};

await smoke("editors-api", async (call, folderId, made, account) => {
  const listed = await call("editors_api_reference", { api: "sheets" });
  check("reference lists the Sheets request kinds", Object.keys(listed.requests).length > 60);

  // Docs: find, replace and style, a header with text, a named range, a tab.
  const doc = await call("create_document", { account, title: "mcp editors smoke", folder_id: folderId, markdown: "# Plan\n\nShip the old build, then the old docs.\n\n| a | b |\n|---|---|\n| 1 | 2 |" });
  made(doc.documentId);
  const found = await call("find_in_document", { account, document_id: doc.documentId, text: "old", whole_word: true });
  check("find_in_document finds both", found.total === 2);
  const edits = [...found.matches].reverse().flatMap((m: { range: [number, number] }) => [
    { deleteContentRange: { range: { startIndex: m.range[0], endIndex: m.range[1] } } },
    { insertText: { location: { index: m.range[0] }, text: "new" } },
    { updateTextStyle: { range: { startIndex: m.range[0], endIndex: m.range[0] + 3 }, textStyle: { bold: true, foregroundColor: { color: { rgbColor: { red: 0.8 } } } }, fields: "bold,foregroundColor" } },
  ]);
  const first = await call("batch_update_document", {
    account,
    document_id: doc.documentId,
    requests: [...edits, { createHeader: { type: "DEFAULT" } }, { createNamedRange: { name: "plan", range: { startIndex: 1, endIndex: 5 } } }, { addDocumentTab: { tabProperties: { title: "Notes" } } }],
    expected_revision: found.revisionId,
  });
  const headerId = first.replies.find((r: { createHeader?: { headerId: string } }) => r.createHeader)?.createHeader.headerId;
  check("batch_update_document returns the header's id", typeof headerId === "string");
  await call("batch_update_document", { account, document_id: doc.documentId, requests: [{ insertText: { location: { segmentId: headerId, index: 0 }, text: "Confidential" } }], expected_revision: first.revisionId });
  const stale = await call("batch_update_document", { account, document_id: doc.documentId, requests: [{ insertText: { location: { index: 1 }, text: "x" } }], expected_revision: found.revisionId }).catch((e: unknown) => String(e));
  console.log("stale answer:", String(stale).slice(0, 600));
  check("a stale revision is refused as stale_revision", String(stale).includes("stale_revision"));
  const wrong = await call("batch_update_document", { account, document_id: doc.documentId, requests: [{ insertTxt: { text: "x" } }] }).catch((e: unknown) => String(e));
  check("a misspelt kind is refused before sending", String(wrong).includes("did you mean insertText"));
  const read = await call("get_document", { account, document_id: doc.documentId, parts: ["body", "headers", "named_ranges"] });
  console.log("tabs:", JSON.stringify(read.tabs));
  check("two tabs", read.tabs.length === 2);
  check("the header holds its text", JSON.stringify(read.headers).includes("Confidential"));
  check("the named range is there", JSON.stringify(read.namedRanges).includes("plan"));
  const styled = read.body.flatMap((e: { runs?: { text: string; style: Record<string, unknown> }[] }) => e.runs ?? []).filter((r: { text: string }) => r.text === "new");
  console.log("styled runs:", JSON.stringify(styled));
  check("both replacements are bold", styled.length === 2 && styled.every((r: { style: { bold?: boolean } }) => r.style.bold));
  const table = read.body.find((e: { type: string }) => e.type === "table");
  check("the table's cells have ranges", Array.isArray(table?.cells?.[0]?.cells?.[0]?.range));

  // Docs: patterns, a tab through the markdown tools, a local image.
  const pattern = await call("find_in_document", { account, document_id: doc.documentId, text: "n[a-z]w\\b", regex: true, segments: "body" });
  check("a regular expression finds both replacements", pattern.total === 2);
  const notesTab = read.tabs.find((t: { title: string }) => t.title === "Notes");
  await call("append_to_document", { account, document_id: doc.documentId, tab: notesTab.tabId, markdown: "## Tab notes\n\nwritten in the second tab" });
  const tabRead = await call("read_document", { account, document_id: doc.documentId, tab: "Notes" });
  check("markdown goes into the tab named", tabRead.markdown.includes("written in the second tab") && tabRead.tabId === notesTab.tabId);
  if (image) {
    const now = await call("get_document", { account, document_id: doc.documentId });
    const inserted = await call("batch_update_document", {
      account,
      document_id: doc.documentId,
      requests: [{ insertInlineImage: { uri: "image:logo", location: { index: 1 }, objectSize: { width: { magnitude: 48, unit: "PT" } } } }],
      images: { logo: { path: image } },
      expected_revision: now.revisionId,
    });
    console.log("image:", JSON.stringify(inserted.images));
    check("the local image went in and its Drive copy was removed", inserted.images?.[0]?.staged === "removed" && JSON.stringify(inserted.replies).includes("insertInlineImage"));
  }

  // Comments, sharing, revisions on the document.
  const comment = await call("add_comment", { account, file_id: doc.documentId, content: "Is this the final wording?", quoted: "new build" });
  await call("reply_to_comment", { account, file_id: doc.documentId, comment_id: comment.commentId, content: "Yes.", action: "resolve" });
  const comments = await call("list_comments", { account, file_id: doc.documentId });
  check("the comment is there, resolved, with its reply", comments.resolved === 1 && comments.comments[0]?.replies?.length === 1);
  await call("delete_comment", { account, file_id: doc.documentId, comment_id: comment.commentId });
  const shared = await call("share_file", { account, file_id: doc.documentId, type: "anyone", role: "reader" });
  const open = await call("list_permissions", { account, file_id: doc.documentId });
  check("link sharing is on", open.linkSharing === "anyone with the link: reader");
  await call("remove_permission", { account, file_id: doc.documentId, permission_id: shared.permissionId });
  const closed = await call("list_permissions", { account, file_id: doc.documentId });
  check("link sharing is off again", closed.linkSharing === "restricted");
  const history = await call("list_revisions", { account, file_id: doc.documentId });
  console.log("revisions:", history.revisions.length, JSON.stringify(history.revisions[0]));
  check("the document has revisions with export formats", history.revisions.length > 0 && (history.revisions[0].formats ?? []).includes("pdf"));
  const old = await call("download_revision", { account, file_id: doc.documentId, revision_id: history.revisions[0].revisionId, format: "txt", save_dir: "smoke" });
  console.log("old revision:", JSON.stringify(old));
  check("an old revision is saved", old.size > 0 && old.exportedAs === "txt");

  // Sheets: values, A1 in requests, conditional format, merge, a new sheet, copies.
  const book = await call("create_spreadsheet", { account, title: "mcp editors smoke", folder_id: folderId, sheets: [{ title: "Data", headers: ["Item", "Amount"] }] });
  made(book.spreadsheetId);
  await call("update_values", { account, spreadsheet_id: book.spreadsheetId, data: [{ range: "Data!A2:B4", values: [["a", 5], ["b", -2], ["c", "=B2+B3"]] }] });
  const batch = await call("batch_update_spreadsheet", {
    account,
    spreadsheet_id: book.spreadsheetId,
    requests: [
      { repeatCell: { range: "Data!B2:B4", cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0.00" } } }, fields: "userEnteredFormat.numberFormat" } },
      { addConditionalFormatRule: { index: 0, rule: { ranges: ["Data!B2:B100"], booleanRule: { condition: { type: "NUMBER_LESS", values: [{ userEnteredValue: "0" }] }, format: { textFormat: { foregroundColor: { red: 0.8 } } } } } } },
      { mergeCells: { range: "Data!D1:E1", mergeType: "MERGE_ALL" } },
      { insertDimension: { range: "Data!6:7", inheritFromBefore: false } },
      { setDataValidation: { range: "Data!C2:C4", rule: { condition: { type: "BOOLEAN" } } } },
      { addSheet: { properties: { title: "Summary", sheetId: 777 } } },
      { updateCells: { start: { sheetId: 777, rowIndex: 0, columnIndex: 0 }, rows: [{ values: [{ userEnteredValue: { formulaValue: "=SUM(Data!B2:B4)" } }] }], fields: "userEnteredValue" } },
    ],
  });
  check("addSheet replies with the id it was given", JSON.stringify(batch.replies).includes("777"));
  const outline = await call("get_spreadsheet", { account, spreadsheet_id: book.spreadsheetId });
  console.log("sheets:", JSON.stringify(outline.sheets));
  const data = outline.sheets.find((s: { title: string }) => s.title === "Data");
  check("the merge reads back as A1", JSON.stringify(data.merges) === JSON.stringify(["'Data'!D1:E1"]));
  check("the conditional format reads back", data.conditionalFormats?.length === 1);
  const values = await call("get_values", { account, spreadsheet_id: book.spreadsheetId, ranges: ["Data!A1:B4", "Summary!A1"], value_render: "FORMULA" });
  console.log("values:", JSON.stringify(values.valueRanges));
  check("the formula reads back as a formula", JSON.stringify(values).includes("=SUM(Data!B2:B4)"));
  const appended = await call("append_values", { account, spreadsheet_id: book.spreadsheetId, range: "Data!A1", values: [["d", 1]] });
  console.log("appended:", JSON.stringify(appended));
  await call("clear_values", { account, spreadsheet_id: book.spreadsheetId, ranges: ["Data!A2:A2"] });
  const copied = await call("copy_sheet_to", { account, spreadsheet_id: book.spreadsheetId, sheet: "Summary" });
  check("the sheet was copied", typeof copied.sheetId === "number");
  await call("batch_update_spreadsheet", {
    account,
    spreadsheet_id: book.spreadsheetId,
    requests: [{ createDeveloperMetadata: { developerMetadata: { metadataKey: "smoke-rows", metadataValue: "items", location: { dimensionRange: "Data!3:3" }, visibility: "DOCUMENT" } } }],
  });
  const tags = await call("search_developer_metadata", { account, spreadsheet_id: book.spreadsheetId, data_filters: [{ developerMetadataLookup: { metadataKey: "smoke-rows" } }] });
  console.log("metadata:", JSON.stringify(tags.matches));
  check("developer metadata is found where it was attached", tags.matches[0]?.location === "'Data'!3:3");
  const byTag = await call("get_values", { account, spreadsheet_id: book.spreadsheetId, data_filters: [{ developerMetadataLookup: { metadataKey: "smoke-rows" } }] });
  console.log("values by tag:", JSON.stringify(byTag.valueRanges));
  check("values are read through the tag", JSON.stringify(byTag.valueRanges).includes("b"));

  // Slides: a blank deck, a slide with a shape, text and style.
  const deck = await call("create_presentation", { account, title: "mcp editors smoke", folder_id: folderId });
  made(deck.presentationId);
  const built = await call("batch_update_presentation", {
    account,
    presentation_id: deck.presentationId,
    requests: [
      { createSlide: { objectId: "smoke_slide", slideLayoutReference: { predefinedLayout: "BLANK" } } },
      {
        createShape: {
          objectId: "smoke_box",
          shapeType: "TEXT_BOX",
          elementProperties: {
            pageObjectId: "smoke_slide",
            size: { width: { magnitude: 300, unit: "PT" }, height: { magnitude: 60, unit: "PT" } },
            transform: { scaleX: 1, scaleY: 1, translateX: 50, translateY: 50, unit: "PT" },
          },
        },
      },
      { insertText: { objectId: "smoke_box", insertionIndex: 0, text: "Hello deck" } },
      { updateTextStyle: { objectId: "smoke_box", textRange: { type: "FIXED_RANGE", startIndex: 0, endIndex: 5 }, style: { bold: true }, fields: "bold" } },
    ],
    expected_revision: deck.revisionId,
  });
  console.log("slides replies:", JSON.stringify(built.replies));
  const shown = await call("get_presentation", { account, presentation_id: deck.presentationId });
  check("the new slide shows its text box", JSON.stringify(shown.slides).includes("Hello deck"));
  if (image) {
    const placed = await call("batch_update_presentation", {
      account,
      presentation_id: deck.presentationId,
      requests: [{ createImage: { url: "image:logo", elementProperties: { pageObjectId: "smoke_slide", size: { width: { magnitude: 60, unit: "PT" }, height: { magnitude: 60, unit: "PT" } } } } }],
      images: { logo: { path: image } },
    });
    check("the local image is on the slide and its Drive copy removed", placed.images?.[0]?.staged === "removed" && JSON.stringify(placed.replies).includes("createImage"));
  }
});
