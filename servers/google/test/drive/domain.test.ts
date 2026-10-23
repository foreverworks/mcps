import { describe, expect, it } from "vitest";

import { exportMimeFor, FOLDER_MIME, isNative, shape } from "../../src/drive/domain/entries.js";
import { basename, dirname, isRootPath, nameVariants, quoteForQuery, splitPath } from "../../src/drive/domain/path.js";
import { downloadName, exportPlan } from "../../src/drive/domain/download.js";
import { planMove, type MoveItem } from "../../src/drive/domain/plan.js";
import { mirroredFolder } from "../../src/drive/domain/upload.js";
import { reasonOf } from "../../src/infra/httpJson.js";
import { isRateLimited } from "../../src/infra/retry.js";

describe("paths", () => {
  it("collapses empty segments so a trailing or doubled slash means nothing", () => {
    expect(splitPath("/Accounting//Bookkeeper/")).toEqual(["Accounting", "Bookkeeper"]);
    expect(splitPath("Accounting/Bookkeeper")).toEqual(["Accounting", "Bookkeeper"]);
  });

  it("treats the empty string and a lone slash as the root", () => {
    expect(isRootPath("")).toBe(true);
    expect(isRootPath("/")).toBe(true);
    expect(isRootPath("Receipts")).toBe(false);
  });

  it("splits a name off the end", () => {
    expect(basename("a/b/c.pdf")).toBe("c.pdf");
    expect(dirname("a/b/c.pdf")).toBe("a/b");
    expect(dirname("c.pdf")).toBe("");
  });

  // A name with an apostrophe is not exotic here: Romanian filenames have them,
  // and an unescaped one silently changes the query rather than erroring.
  it("escapes quotes and backslashes for Drive's query grammar", () => {
    expect(quoteForQuery("Don't")).toBe("'Don\\'t'");
    expect(quoteForQuery("a\\b")).toBe("'a\\\\b'");
    expect(quoteForQuery("plain")).toBe("'plain'");
  });
});

describe("entries", () => {
  it("reports no size for a native file rather than zero", () => {
    const doc = shape({ id: "1", name: "Notes", mimeType: "application/vnd.google-apps.document" });
    expect(doc.isNative).toBe(true);
    expect(doc.bytes).toBeNull();

    const pdf = shape({ id: "2", name: "a.pdf", mimeType: "application/pdf", size: "1024" });
    expect(pdf.isNative).toBe(false);
    expect(pdf.bytes).toBe(1024);
  });

  it("counts a folder as native but flags it separately", () => {
    const folder = shape({ id: "3", name: "Receipts", mimeType: FOLDER_MIME });
    expect(isNative(FOLDER_MIME)).toBe(true);
    expect(folder.isFolder).toBe(true);
  });

  it("exports a Sheet as CSV whichever text format was asked for", () => {
    expect(exportMimeFor("application/vnd.google-apps.spreadsheet", "markdown")).toBe("text/csv");
    expect(exportMimeFor("application/pdf", "text")).toBeNull();
  });
});

const item = (id: string, name: string, parents: string[], target = name): MoveItem => ({
  entry: { id, name, mimeType: "application/pdf", isNative: false, isFolder: false, bytes: 1, modified: null, trashed: false, link: null },
  currentParents: parents,
  targetName: target,
});

describe("move planning", () => {
  it("blocks a name the destination already holds instead of creating a duplicate", () => {
    const plan = planMove([item("a", "invoice.pdf", ["old"])], "dest", new Map([["invoice.pdf", "other"]]));
    expect(plan.steps[0]?.verdict).toBe("blocked");
    expect(plan.willWrite).toBe(0);
    expect(plan.blocked).toBe(1);
  });

  it("blocks two sources in one call that would collide with each other", () => {
    const plan = planMove([item("a", "x.pdf", ["p1"]), item("b", "y.pdf", ["p2"], "x.pdf")], "dest", new Map());
    expect(plan.steps.map((s) => s.verdict)).toEqual(["move", "blocked"]);
  });

  it("says already_there rather than writing a move that changes nothing", () => {
    const plan = planMove([item("a", "x.pdf", ["dest"])], "dest", new Map());
    expect(plan.steps[0]?.verdict).toBe("already_there");
    expect(plan.willWrite).toBe(0);
  });

  it("still writes when the file is in the destination but is being renamed", () => {
    const plan = planMove([item("a", "x.pdf", ["dest"], "DOC-0100. x.pdf")], "dest", new Map());
    expect(plan.steps[0]?.verdict).toBe("rename_and_move");
    expect(plan.willWrite).toBe(1);
  });

  it("does not let a file that is already there block itself", () => {
    const plan = planMove([item("a", "x.pdf", ["dest"])], "dest", new Map([["x.pdf", "a"]]));
    expect(plan.steps[0]?.verdict).toBe("already_there");
  });
});

describe("Drive's 403", () => {
  // Drive answers 403 both for a quota refusal (`usageLimits`, common on a
  // shared OAuth client) and for a missing permission; only the first is
  // worth retrying.
  it("tells a quota refusal apart from a permission one", () => {
    const limited = (body: unknown) => isRateLimited(403, reasonOf(body));
    expect(limited({ error: { errors: [{ domain: "usageLimits", reason: "rateLimitExceeded" }] } })).toBe(true);
    expect(limited({ error: { message: "Quota exceeded for quota metric 'Queries'" } })).toBe(true);
    expect(limited({ error: { errors: [{ domain: "global", reason: "insufficientFilePermissions" }] } })).toBe(false);
  });
});

describe("Unicode normalisation", () => {
  // A name created from macOS is often stored NFD; a path typed elsewhere is
  // NFC, and Drive's `name =` compares strings, not graphemes.
  it("asks for both spellings of a name that has a diacritic", () => {
    const variants = nameVariants("Café".normalize("NFC"));
    expect(variants).toHaveLength(2);
    expect(variants.some((v) => v.includes("\u0301"))).toBe(true);
  });

  it("does not duplicate a name that has no diacritic", () => {
    expect(nameVariants("Receipts")).toEqual(["Receipts"]);
  });
});

describe("the Drive mirror", () => {
  it("names the folder a mirror file stands for, and nothing for a file outside it", () => {
    const mirror = "/srv/drive/my-drive";
    expect(mirroredFolder(mirror, "/srv/drive/my-drive/Branding/logo.pdf")).toBe("Branding");
    expect(mirroredFolder(`${mirror}/`, "/srv/drive/my-drive/Accounting/Receipts/x.pdf")).toBe("Accounting/Receipts");
    expect(mirroredFolder(mirror, "/srv/drive/my-drive/RCLONE_TEST")).toBe("");
    expect(mirroredFolder(mirror, mirror)).toBeUndefined();
    expect(mirroredFolder(mirror, "/srv/drive/my-drive-old/x.pdf")).toBeUndefined();
    expect(mirroredFolder(mirror, "/srv/inbox/x.pdf")).toBeUndefined();
    expect(mirroredFolder(mirror, "/srv/drive/my-drive/../other/x.odt")).toBeUndefined();
  });
});

describe("downloads", () => {
  it("exports each kind of Google file in its default format, or one it has, and refuses the rest", () => {
    expect(exportPlan("application/vnd.google-apps.document", "")).toMatchObject({ format: "pdf", ext: "pdf" });
    expect(exportPlan("application/vnd.google-apps.spreadsheet", "")).toMatchObject({ format: "xlsx" });
    expect(exportPlan("application/vnd.google-apps.presentation", "pdf")).toMatchObject({ mime: "application/pdf" });
    expect(exportPlan("application/vnd.google-apps.spreadsheet", "docx")).toHaveProperty("refused");
    expect(exportPlan("application/vnd.google-apps.form", "")).toHaveProperty("refused");
  });

  it("names a download as one path segment, with the export's extension once", () => {
    expect(downloadName("Weekly sync - 2030/01/15 10:00 CET", "pdf")).toBe("Weekly sync - 2030_01_15 10:00 CET.pdf");
    expect(downloadName("Raport.PDF", "pdf")).toBe("Raport.PDF");
    expect(downloadName("logo.svg")).toBe("logo.svg");
    expect(downloadName("..")).toBe("_");
    expect(downloadName("  ", "csv")).toBe("download.csv");
  });
});
