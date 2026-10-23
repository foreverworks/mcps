import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sha256Of } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { downloadDocuments } from "../src/app/usecases/records.js";
import { buildDeps } from "../src/composition.js";
import { asAppError, remedyFor } from "../src/domain/errors.js";
import { PDF_TEXT, tsdrDocuments, tsdrStatus } from "./fixtures.js";
import { noSleep, stubFetch, type Answer } from "./stubFetch.js";

const KEY = "test-key-not-a-real-one";

const tsdrOnly = (answer: (url: string, n: number) => Answer, env: Readonly<Record<string, string>> = { USPTO_TSDR_API_KEY: KEY }) => {
  const stub = stubFetch((asked, n) => answer(asked.url, n));
  const deps = buildDeps({ TRADEMARKS_SOURCES: "tsdr", ...env }, { fetch: stub.fetch, sleep: noSleep, random: () => 0 });
  const tsdr = deps.records.find((r) => r.office === "US");
  if (tsdr === undefined) throw new Error("no TSDR source");
  return { tsdr, deps, asked: stub.asked };
};

const failureOf = async (p: Promise<unknown>) => asAppError(await p.then(() => undefined, (e: unknown) => e));

describe("TSDR, a mark's history", () => {
  it("asks for the status as JSON with the key in its header, and reads every step, newest first", async () => {
    const { tsdr, asked } = tsdrOnly(() => ({ json: tsdrStatus() }));
    const history = await tsdr.history(" 97000001 ");
    expect(asked[0]).toMatchObject({ url: "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn97000001/info", method: "GET" });
    expect(asked[0]?.headers).toMatchObject({ "uspto-api-key": KEY, accept: "application/json" });
    expect(asked[0]?.headers["user-agent"]).toMatch(/^mcps-trademarks\//);
    expect(history).toEqual({
      office: "US",
      id: "97000001",
      mark: "TURNIP",
      status: "registered",
      statusText: "The registration has been renewed.",
      statusCode: 800,
      statusDate: "2021-03-01",
      category: "LIVE/REGISTRATION/Issued and Active",
      filed: "2010-01-04",
      registered: "2011-02-01",
      registrationNumber: "7100001",
      renewed: "2021-02-01",
      events: [
        { date: "2022-06-14", code: "CHAN", description: "APPLICANT/CORRESPONDENCE CHANGES (NON-RESPONSIVE) ENTERED", number: 3 },
        { date: "2011-02-01", code: "R.PR", description: "REGISTERED-PRINCIPAL REGISTER", number: 2 },
        { date: "2010-01-07", code: "NWAP", description: "NEW APPLICATION ENTERED", number: 1 },
      ],
      link: "https://tsdr.uspto.gov/#caseNumber=97000001&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch",
    });
  });

  it("calls an abandoned application dead, with its date and USPTO's sentence", async () => {
    const { tsdr } = tsdrOnly(() => ({
      json: tsdrStatus({
        status: 602,
        usRegistrationNumber: "",
        usRegistrationDate: null,
        dateRenewal: null,
        dateAbandoned: "2010-11-08",
        extStatusDesc: "Abandoned because the applicant failed to respond.  To view all documents, click above.",
        tm5StatusDesc: "DEAD/APPLICATION/Refused/Dismissed or Invalidated",
      }),
    }));
    const history = await tsdr.history("97000001");
    expect(history).toMatchObject({ status: "dead", statusCode: 602, abandoned: "2010-11-08", statusText: "Abandoned because the applicant failed to respond. To view all documents, click above." });
    expect(history).not.toHaveProperty("registrationNumber");
    expect(history).not.toHaveProperty("registered");
  });

  it("names what failed: no key, a refused key, no such serial, a shape it does not know, a number that is not a serial", async () => {
    const noKey = tsdrOnly(() => ({ json: tsdrStatus() }), {});
    const missing = await failureOf(noKey.tsdr.history("97000001"));
    expect(missing).toMatchObject({ kind: "config", source: "uspto-tsdr" });
    expect(remedyFor(missing as NonNullable<typeof missing>)).toContain("account.uspto.gov/profile/api-manager");
    expect(noKey.asked).toHaveLength(0);

    const refused = await failureOf(tsdrOnly(() => ({ status: 401, json: { message: "Unauthorized" } })).tsdr.history("97000001"));
    expect(refused).toMatchObject({ kind: "auth", source: "uspto-tsdr", status: 401 });
    expect(remedyFor(refused as NonNullable<typeof refused>)).toContain("TSDR API key");

    expect(await failureOf(tsdrOnly(() => ({ status: 404, json: {} })).tsdr.history("97000009"))).toMatchObject({ kind: "not_found", message: expect.stringContaining("97000009") });
    expect(await failureOf(tsdrOnly(() => ({ json: { cases: [] } })).tsdr.history("97000001"))).toMatchObject({ kind: "drift", source: "uspto-tsdr" });
    const notSerial = tsdrOnly(() => ({ json: tsdrStatus() }));
    expect(await failureOf(notSerial.tsdr.history("7100001"))).toMatchObject({ kind: "input" });
    expect(notSerial.asked).toHaveLength(0);
  });
});

describe("TSDR, a mark's documents", () => {
  it("asks for the list as XML (TSDR refuses JSON there) and reads it newest first", async () => {
    const { tsdr, asked } = tsdrOnly(() => ({ text: tsdrDocuments, contentType: "application/xml;charset=UTF-8" }));
    expect(await tsdr.documents("97000001")).toEqual([
      { date: "2021-03-01", type: "ACR", description: "Notice-Acceptance-Renewal", category: "outgoing", pages: 1 },
      { date: "2010-06-01", type: "OOA", description: "Offc Action Outgoing & Notes", category: "outgoing", pages: 5 },
      { date: "2010-01-04", type: "SPE", description: "Specimen", category: "incoming", pages: 2 },
    ]);
    expect(asked[0]).toMatchObject({ url: "https://tsdrapi.uspto.gov/ts/cd/casedocs/sn97000001/info" });
    expect(asked[0]?.headers.accept).toBe("application/xml");
    expect(await failureOf(tsdrOnly(() => ({ text: "<html>maintenance</html>" })).tsdr.documents("97000001"))).toMatchObject({ kind: "drift" });
  });

  it("saves the documents a filter picks as one PDF in the outbox, with its SHA-256", async () => {
    const outbox = await mkdtemp(join(tmpdir(), "trademarks-outbox-"));
    const { deps, asked } = tsdrOnly(() => ({ text: PDF_TEXT, contentType: "application/pdf;charset=UTF-8" }), { USPTO_TSDR_API_KEY: KEY, TRADEMARKS_OUTBOX_DIR: outbox });
    const saved = await downloadDocuments(deps, "US", "97000001", { type: "OOA", from: "2010-01-01", to: "2010-12-31" });
    expect(asked[0]?.url).toBe("https://tsdrapi.uspto.gov/ts/cd/casedocs/bundle.pdf?sn=97000001&type=OOA&fromDate=2010-01-01&toDate=2010-12-31");
    expect(asked[0]?.headers.accept).toBe("application/pdf");
    expect(saved).toEqual({
      source: "uspto-tsdr",
      office: "US",
      id: "97000001",
      type: "OOA",
      from: "2010-01-01",
      to: "2010-12-31",
      path: join(outbox, "us-97000001-OOA-2010-01-01-2010-12-31.pdf"),
      sha256: sha256Of(Buffer.from(PDF_TEXT)),
      size: Buffer.byteLength(PDF_TEXT),
    });
    expect(await readFile(saved.path, "utf8")).toBe(PDF_TEXT);
  });

  it("refuses a bundle that is not a PDF and a window that ends before it starts", async () => {
    const outbox = await mkdtemp(join(tmpdir(), "trademarks-outbox-"));
    const page = tsdrOnly(() => ({ text: "<html>error</html>" }), { USPTO_TSDR_API_KEY: KEY, TRADEMARKS_OUTBOX_DIR: outbox });
    expect(await failureOf(downloadDocuments(page.deps, "US", "97000001", {}))).toMatchObject({ kind: "drift" });
    expect(page.asked[0]?.url).toBe("https://tsdrapi.uspto.gov/ts/cd/casedocs/bundle.pdf?sn=97000001");
    const backwards = tsdrOnly(() => ({ text: PDF_TEXT }), { USPTO_TSDR_API_KEY: KEY, TRADEMARKS_OUTBOX_DIR: outbox });
    expect(await failureOf(downloadDocuments(backwards.deps, "US", "97000001", { from: "2011-01-01", to: "2010-01-01" }))).toMatchObject({ kind: "input" });
    expect(backwards.asked).toHaveLength(0);
  });
});
