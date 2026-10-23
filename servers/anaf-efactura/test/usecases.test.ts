/**
 * Use cases against FAKE ports (test/fixtures.ts). No network, no credentials,
 * no ANAF account, every path a fresh temp dir.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asInputFileError, type FileSource, inCall, type LinkForPerson, readInputFile } from "@foreverworks/mcp-kit";
import { describe, expect, it, vi } from "vitest";

import { beginAuthorization, completeAuthorization } from "../src/app/usecases/authorization.js";
import { listEtransport } from "../src/app/usecases/etransport.js";
import { downloadInvoice, listInvoices, listInvoicesWindow } from "../src/app/usecases/invoices.js";
import { refresh, refreshTokens, tokenStatus } from "../src/app/usecases/tokens.js";
import { uploadConfirmationLine, uploadInvoice, uploadStatus } from "../src/app/usecases/uploads.js";
import { makeUploadLedger } from "../src/infra/uploadLedger.js";
import { resolvedUploadArgs, resolveUpload, toUploadArgs } from "../src/mcp/uploadArgs.js";
import { POLICY } from "../src/mcp/policy.js";
import { apiError, asAppError, fail, OUTCOME_UNKNOWN } from "../src/domain/errors.js";
import { REFRESH_SKEW_S } from "../src/domain/tokens.js";
import { readInvoiceXml } from "../src/infra/xml.js";
import {
  anafStub,
  ARCHIVE,
  authorizationStub,
  bundle,
  DAY,
  errorOf,
  fakeDeps,
  tempDir,
  NOW,
  tokensStub,
  UBL_INVOICE,
} from "./fixtures.js";

describe("the default CIF", () => {
  it("comes from app.json, normalised, when the caller names none", async () => {
    const listMessages = vi.fn(anafStub().listMessages);
    await listInvoices(fakeDeps({ anaf: anafStub({ listMessages }) }), { zile: 7, cif: "", test: false });
    expect(listMessages).toHaveBeenCalledWith({ cif: "92345672", zile: 7, test: false });
  });

  it("is overridden by an explicit argument, because one grant can cover several", async () => {
    const listMessages = vi.fn(anafStub().listMessages);
    await listInvoices(fakeDeps({ anaf: anafStub({ listMessages }) }), { zile: 7, cif: "RO87654329", test: false });
    expect(listMessages).toHaveBeenCalledWith({ cif: "87654329", zile: 7, test: false });
  });

  it("is a config fault, not a crash, when neither exists", async () => {
    const d = fakeDeps({ identity: async () => ({ appName: "app", clientIdLast4: "abcd" }) });
    const error = await errorOf(() => listInvoices(d, { zile: 7, cif: "", test: false }));
    expect(error?.kind).toBe("config");
    expect(error?.message).toContain("company_cif");
  });
});

describe("listInvoicesWindow", () => {
  it("passes ANAF millisecond bounds and drops an empty filter", async () => {
    const listMessagesPaginated = vi.fn(anafStub().listMessagesPaginated);
    await listInvoicesWindow(fakeDeps({ anaf: anafStub({ listMessagesPaginated }) }), {
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      cif: "",
      page: 2,
      filtru: "",
      test: false,
    });
    expect(listMessagesPaginated).toHaveBeenCalledWith({
      cif: "92345672",
      startTimeMs: Date.UTC(2026, 2, 1),
      endTimeMs: Date.UTC(2026, 3, 1),
      pagina: 2,
      test: false,
    });
  });

  it("refuses a window ANAF would reject, without spending a call", async () => {
    const listMessagesPaginated = vi.fn(anafStub().listMessagesPaginated);
    const error = await errorOf(() =>
      listInvoicesWindow(fakeDeps({ anaf: anafStub({ listMessagesPaginated }) }), {
        startDate: "2026-01-01",
        endDate: "2026-06-01",
        cif: "",
        page: 1,
        filtru: "",
        test: false,
      }),
    );
    expect(error?.kind).toBe("input");
    expect(listMessagesPaginated).not.toHaveBeenCalled();
  });
});

describe("downloadInvoice", () => {
  it("saves the archive in the outbox by default, and in a folder under it on request", async () => {
    const d = fakeDeps();
    const out = await downloadInvoice(d, { messageId: "4321", saveDir: "", test: false });
    expect(out).toMatchObject({
      ok: true,
      path: `${d.paths.downloadsDir}/4321.zip`,
      bytes: ARCHIVE.length,
      sha256: createHash("sha256").update(ARCHIVE).digest("hex"),
      md5: createHash("md5").update(ARCHIVE).digest("hex"),
      entries: [{ name: "5001.xml" }, { name: "semnatura_5001.xml" }],
      seal: { verdict: "inconclusive", checkedBy: "local" },
      invoice: { number: "EX-0042" },
    });
    const nested = await downloadInvoice(d, { messageId: "4321", saveDir: "2026-09/in", test: false });
    expect(nested.path).toBe(`${d.paths.downloadsDir}/2026-09/in/4321.zip`);
    const absolute = await downloadInvoice(d, { messageId: "4321", saveDir: `${d.paths.downloadsDir}/x`, test: false });
    expect(absolute.path).toBe(`${d.paths.downloadsDir}/x/4321.zip`);
  });

  it("refuses a save_dir outside the outbox before downloading anything", async () => {
    const downloadMessage = vi.fn(anafStub().downloadMessage);
    const d = fakeDeps({ anaf: anafStub({ downloadMessage }) });
    expect(await errorOf(() => downloadInvoice(d, { messageId: "1", saveDir: "/tmp/elsewhere", test: false }))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => downloadInvoice(d, { messageId: "1", saveDir: "../up", test: false }))).toMatchObject({ kind: "input" });
    expect(downloadMessage).not.toHaveBeenCalled();
  });

  it("refuses to write ANAF's refusal to disk under an invoice's name, and says what ANAF said", async () => {
    const writeFile = vi.fn(async () => "unused");
    const refusal = { eroare: "Pentru id=21 nu exista inregistrata nici o factura", titlu: "Descarcare mesaj" };
    const error = await errorOf(() =>
      downloadInvoice(
        fakeDeps({
          anaf: anafStub({ downloadMessage: async () => ({ bytes: Buffer.from(JSON.stringify(refusal)), refusal }) }),
          files: { ...fakeDeps().files, writeFile },
        }),
        { messageId: "21", saveDir: "", test: false },
      ),
    );
    expect(error).toMatchObject({ kind: "api" });
    expect(error?.message).toContain("nu exista inregistrata");
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("uploadInvoice", () => {
  const args = { xml: UBL_INVOICE, cif: "", standard: "UBL", extern: false, autofactura: false, executare: false, test: true };

  it("reads ANAF's receipt into a verdict and reports what the XML says was filed", async () => {
    const out = await uploadInvoice(fakeDeps(), args);
    expect(out).toMatchObject({
      environment: "test",
      cif: "92345672",
      accepted: true,
      uploadId: "5001",
      invoice: { number: "EX-0042", payable: "1234.50", currency: "RON" },
    });
  });

  it("sends the document's bytes as UTF-8 with the flags ANAF wants", async () => {
    const uploadInvoiceSpy = vi.fn(anafStub().uploadInvoice);
    await uploadInvoice(fakeDeps({ anaf: anafStub({ uploadInvoice: uploadInvoiceSpy }) }), { ...args, extern: true });
    const q = uploadInvoiceSpy.mock.calls[0]?.[0];
    expect(q?.xml.toString("utf8")).toBe(UBL_INVOICE);
    expect(q).toMatchObject({ cif: "92345672", standard: "UBL", flags: { extern: true, autofactura: false, executare: false }, test: true });
  });

  it("reports a refusal as not accepted, with ANAF's reason", async () => {
    const d = fakeDeps({
      anaf: anafStub({ uploadInvoice: async () => ({ header: { executionStatus: 1, errors: [{ errorMessage: "CIF invalid" }] }, raw: "<x/>" }) }),
    });
    expect(await uploadInvoice(d, args)).toMatchObject({ accepted: false, uploadId: undefined, errors: ["CIF invalid"] });
  });

  it("refuses an empty document without a call", async () => {
    const spy = vi.fn(anafStub().uploadInvoice);
    expect(await errorOf(() => uploadInvoice(fakeDeps({ anaf: anafStub({ uploadInvoice: spy }) }), { ...args, xml: "" }))).toMatchObject({
      kind: "input",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("gives a user the line the result will match, ending with the file's sha256", () => {
    const line = uploadConfirmationLine(readInvoiceXml, { ...args, test: false });
    expect(line).toContain("PRODUCTION");
    expect(line).toContain("invoice EX-0042 of 2026-09-28");
    expect(line).toContain("payable 1234.50 RON");
    expect(line).toContain(`file sha256 ${createHash("sha256").update(UBL_INVOICE).digest("hex").slice(0, 12)}`);
  });

  it("refuses an IBAN that fails its check digits before anything is sent", async () => {
    const spy = vi.fn(anafStub().uploadInvoice);
    const broken = UBL_INVOICE.replace("RO49AAAA1B31007593840000", "RO49AAAA1B31007593840001");
    expect(broken).not.toBe(UBL_INVOICE);
    const error = await errorOf(() => uploadInvoice(fakeDeps({ anaf: anafStub({ uploadInvoice: spy }) }), { ...args, xml: broken }));
    expect(error).toMatchObject({ kind: "input", message: expect.stringContaining("check digits") });
    expect(spy).not.toHaveBeenCalled();
  });

  it("files the same bytes in production once, and again only with refile", async () => {
    const spy = vi.fn(anafStub().uploadInvoice);
    const deps = fakeDeps({ anaf: anafStub({ uploadInvoice: spy }) });
    const production = { ...args, test: false };
    expect(await uploadInvoice(deps, production)).toMatchObject({ accepted: true, uploadId: "5001" });
    const again = await errorOf(() => uploadInvoice(deps, production));
    expect(again).toMatchObject({ kind: "input", message: expect.stringContaining("upload 5001") });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await uploadInvoice(deps, { ...production, refile: true })).toMatchObject({ accepted: true });
    expect(spy).toHaveBeenCalledTimes(2);
    // Test uploads have no legal effect: not recorded, never refused.
    await uploadInvoice(deps, args);
    await uploadInvoice(deps, args);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("refuses a retry after a lost answer, because the first may have been filed", async () => {
    const lost = vi.fn(async () => fail(apiError(503, "gateway", { reason: OUTCOME_UNKNOWN })));
    const deps = fakeDeps({ anaf: anafStub({ uploadInvoice: lost }) });
    expect(await errorOf(() => uploadInvoice(deps, { ...args, test: false }))).toMatchObject({ reason: OUTCOME_UNKNOWN });
    expect(await errorOf(() => uploadInvoice(deps, { ...args, test: false }))).toMatchObject({
      kind: "input",
      message: expect.stringContaining("outcome is unknown"),
    });
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe("uploadStatus", () => {
  it("takes an upload id of digits only, refused before asking", async () => {
    const spy = vi.fn(anafStub().uploadStatus);
    const deps = fakeDeps({ anaf: anafStub({ uploadStatus: spy }) });
    expect(await uploadStatus(deps, { idIncarcare: " 5001 ", test: true })).toMatchObject({ idIncarcare: "5001", state: "ok" });
    expect(await errorOf(() => uploadStatus(deps, { idIncarcare: "index_incarcare=5001", test: true }))).toMatchObject({ kind: "input" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("upload_invoice from a file", () => {
  const inbox = mkdtempSync(join(tmpdir(), "anaf-inbox-"));
  const readInput = (source: FileSource) => readInputFile(source, { roots: [inbox] });
  const flags = { cif: "", standard: "UBL", extern: false, autofactura: false, executare: false, test: true, refile: false };

  it("reads the file into the text a user confirms and the upload files, byte for byte", async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(UBL_INVOICE, "utf8")]);
    writeFileSync(join(inbox, "EX-0042.xml"), bytes);
    const resolved = await resolveUpload(readInput, readInvoiceXml, { ...flags, xml: { path: "EX-0042.xml" } });
    expect(Buffer.from(resolved["xml"] as string, "utf8").equals(bytes)).toBe(true);
    expect(resolved["xml_read"]).toMatchObject({ name: "EX-0042.xml", size: bytes.length });
    expect(await resolveUpload(readInput, readInvoiceXml, resolved)).toBe(resolved);
    const rule = POLICY["upload_invoice"];
    expect(rule?.access === "money" && rule.resolve !== undefined).toBe(true);
    expect(rule?.access === "money" ? rule.summary(resolved) : "").toContain("invoice EX-0042 of 2026-09-28");

    const spy = vi.fn(anafStub().uploadInvoice);
    const out = await uploadInvoice(fakeDeps({ anaf: anafStub({ uploadInvoice: spy }) }), toUploadArgs(resolvedUploadArgs.parse(resolved)));
    expect(spy.mock.calls[0]?.[0].xml.equals(bytes)).toBe(true);
    expect(out).toMatchObject({ bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), file: { name: "EX-0042.xml" } });
  });

  it("takes a script's base64 only with the source's sha256, and checks it", async () => {
    const bytes = Buffer.from(UBL_INVOICE, "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const resolved = await resolveUpload(readInput, readInvoiceXml, { ...flags, xml: { content_base64: bytes.toString("base64"), sha256 } });
    expect(resolved["xml"]).toBe(UBL_INVOICE);
    const unsigned = await resolveUpload(readInput, readInvoiceXml, { ...flags, xml: { content_base64: bytes.toString("base64") } }).catch((t: unknown) =>
      asInputFileError(t),
    );
    expect(unsigned).toMatchObject({ code: "sha256_required" });
    const altered = await resolveUpload(readInput, readInvoiceXml, {
      ...flags,
      xml: { content_base64: Buffer.from(UBL_INVOICE.replace("1234.50", "1234.60")).toString("base64"), sha256 },
    }).catch((t: unknown) => asInputFileError(t));
    expect(altered).toMatchObject({ kind: "checksum_mismatch" });
  });

  it("refuses no document, a file that is not UTF-8, and a link", async () => {
    expect(await errorOf(() => resolveUpload(readInput, readInvoiceXml, flags))).toMatchObject({ kind: "input" });
    writeFileSync(join(inbox, "latin1.xml"), Buffer.from("<Invoice>Factur\u0103 \u00e9</Invoice>", "latin1"));
    expect(await errorOf(() => resolveUpload(readInput, readInvoiceXml, { ...flags, xml: { path: "latin1.xml" } }))).toMatchObject({
      kind: "input",
      message: expect.stringMatching(/not UTF-8/),
    });
    symlinkSync("/etc/hostname", join(inbox, "link.xml"));
    const refused = await resolveUpload(readInput, readInvoiceXml, { ...flags, xml: { path: "link.xml" } }).catch((t: unknown) => asInputFileError(t));
    expect(refused).toMatchObject({ kind: "input", code: "symlink" });
  });
});

describe("refresh", () => {
  it("does nothing while the cushion holds, because a refresh spends the refresh token", async () => {
    const rotate = vi.fn(tokensStub().rotate);
    const out = await refreshTokens(fakeDeps({ tokens: tokensStub({ rotate }) }), { force: false });
    expect(out).toMatchObject({ refreshed: false });
    expect(rotate).not.toHaveBeenCalled();
  });

  it("refreshes once the cushion is gone, or on force", async () => {
    const rotate = vi.fn(tokensStub().rotate);
    const stale = bundle({ accessTokenExpEpoch: NOW + REFRESH_SKEW_S - 1 });
    expect(await refreshTokens(fakeDeps({ tokens: tokensStub({ read: async () => stale, rotate }) }), { force: false })).toMatchObject({
      refreshed: true,
    });
    expect(await refreshTokens(fakeDeps({ tokens: tokensStub({ rotate }) }), { force: true })).toMatchObject({ refreshed: true });
    expect(rotate).toHaveBeenCalledTimes(2);
  });

  it("takes the maintenance job's wider window", async () => {
    const rotate = vi.fn(tokensStub().rotate);
    const d = fakeDeps({ tokens: tokensStub({ read: async () => bundle({ accessTokenExpEpoch: NOW + 10 * DAY }), rotate }) });
    expect((await refresh(d, { force: false, withinS: REFRESH_SKEW_S })).refreshed).toBe(false);
    expect((await refresh(d, { force: false, withinS: 14 * DAY })).refreshed).toBe(true);
  });
});

describe("tokenStatus", () => {
  it("reports the app and the CIF without reaching ANAF, and no token material", async () => {
    const hello = vi.fn(anafStub().hello);
    const out = await tokenStatus(fakeDeps({ anaf: anafStub({ hello }) }));
    expect(out).toMatchObject({ appName: "app", clientIdLast4: "abcd", defaultCif: "RO92345672", roles: "EFACTURA" });
    expect(JSON.stringify(out)).not.toContain("old-access");
    expect(hello).not.toHaveBeenCalled();
  });
});

describe("authorization", () => {
  it("begins with a fresh state, remembered, on the first registered redirect", async () => {
    const write = vi.fn(async () => undefined);
    const d = fakeDeps({ authorization: authorizationStub({ pending: { ...authorizationStub().pending, write } }) });
    const out = await beginAuthorization(d, { redirectUri: "" });
    expect(write).toHaveBeenCalledWith({ state: "state-1", redirectUri: "https://example.test/anaf/callback", createdAtEpoch: NOW });
    expect(out.authorizeUrl).toContain("state=state-1");
  });

  it("offers ANAF's page for the client to show the user, telling one without the certificate to decline and pass it on", async () => {
    const offered: LinkForPerson[] = [];
    const out = await inCall({ offer: (link) => void offered.push(link) }, () => beginAuthorization(fakeDeps(), { redirectUri: "" }));
    expect(offered).toEqual([{ url: out.authorizeUrl, message: expect.stringMatching(/qualified certificate.*decline/), next: expect.stringContaining("complete_authorization") }]);
  });

  it("completes only for the state it issued, spending the code once, and answers only dates", async () => {
    const pending = { state: "state-1", redirectUri: "https://example.test/anaf/callback", createdAtEpoch: NOW };
    const exchangeCode = vi.fn(authorizationStub().exchangeCode);
    const replace = vi.fn(async () => undefined);
    const clear = vi.fn(async () => undefined);
    const d = fakeDeps({
      tokens: tokensStub({ replace }),
      authorization: authorizationStub({
        exchangeCode,
        fromRedirect: () => ({ code: "the-code", state: "state-1" }),
        pending: { read: async () => pending, write: async () => undefined, clear },
      }),
    });
    const out = await completeAuthorization(d, { redirectUrl: "https://example.test/anaf/callback?code=the-code&state=state-1", code: "", state: "" });
    expect(exchangeCode).toHaveBeenCalledWith("the-code", pending.redirectUri);
    expect(replace).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(Object.keys(out).toSorted()).toEqual(["accessTokenExpiresAt", "ok", "refreshTokenExpiresAt"]);
    expect(JSON.stringify(out)).not.toContain("new-access");
  });

  it("refuses a mismatched state BEFORE the code is spent", async () => {
    const exchangeCode = vi.fn(authorizationStub().exchangeCode);
    const d = fakeDeps({
      authorization: authorizationStub({
        exchangeCode,
        pending: { read: async () => ({ state: "state-1", redirectUri: "r", createdAtEpoch: NOW }), write: async () => undefined, clear: async () => undefined },
      }),
    });
    expect(await errorOf(() => completeAuthorization(d, { redirectUrl: "", code: "c", state: "forged" }))).toMatchObject({ kind: "input" });
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("wants either the address or code with state, not both", async () => {
    expect(await errorOf(() => completeAuthorization(fakeDeps(), { redirectUrl: "x", code: "c", state: "s" }))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => completeAuthorization(fakeDeps(), { redirectUrl: "", code: "", state: "" }))).toMatchObject({ kind: "input" });
  });
});

describe("listEtransport", () => {
  it("bounds the lookback the same way the invoice listing does", async () => {
    expect((await errorOf(() => listEtransport(fakeDeps(), { zile: 90, cif: "", test: false })))?.kind).toBe("input");
  });
});

describe("uploadInvoice, the ledger under concurrency", () => {
  const args = { xml: UBL_INVOICE, cif: "", standard: "UBL", extern: false, autofactura: false, executare: false, test: false };

  it("files the same bytes once when two calls race, because the claim and the send are one step", async () => {
    // The live case: a client times out and sends the same file again while the first call is at ANAF.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const spy = vi.fn(async () => {
      await gate;
      return anafStub().uploadInvoice({ cif: "", xml: Buffer.alloc(0), standard: "UBL", flags: { extern: false, autofactura: false, executare: false }, test: false, b2c: false });
    });
    const deps = fakeDeps({ anaf: anafStub({ uploadInvoice: spy }), uploads: makeUploadLedger(tempDir("ledger")) });
    // Which of the two reaches the ledger's lock first is the scheduler's choice (a loaded CI runner
    // let the second win): the claim is that exactly one files and the other is refused.
    const settled = Promise.allSettled([uploadInvoice(deps, args), uploadInvoice(deps, args)]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    const outcomes = await settled;
    const filed = outcomes.filter((o) => o.status === "fulfilled").map((o) => (o as PromiseFulfilledResult<unknown>).value);
    const refused = outcomes.filter((o) => o.status === "rejected").map((o) => asAppError((o as PromiseRejectedResult).reason));
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({ accepted: true, uploadId: "5001" });
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ kind: "input", message: expect.stringContaining("already sent to ANAF production") });
    expect(spy).toHaveBeenCalledTimes(1);
  });

});
