/**
 * What setup derives from a person's answers: every list comes from the
 * server's own tables (the toolsets, the consent scopes and APIs), so these
 * tests pin what a person is told to enable and declare to what the consents
 * will actually ask for.
 */
import { describe, expect, it } from "vitest";

import { CONSENT_SCOPES } from "../../src/consent/domain/products.js";
import { ALL_TOOLSETS } from "../../src/mcp/policy.js";
import {
  apisOf,
  carriedVariables,
  consentProductsOf,
  consentSteps,
  consoleLinks,
  installLines,
  newProjectId,
  parseLabels,
  parseToolsets,
  PROJECT_ID,
  scopesOf,
} from "../../src/setup/domain/plan.js";

const S = "https://www.googleapis.com/auth/";

describe("parseToolsets", () => {
  it("reads empty and `all` as every product, and keeps the toolsets' own order", () => {
    expect(parseToolsets("")).toEqual({ ok: ALL_TOOLSETS });
    expect(parseToolsets(" ALL ")).toEqual({ ok: ALL_TOOLSETS });
    expect(parseToolsets("calendar, gmail calendar")).toEqual({ ok: ["gmail", "calendar"] });
  });

  it("names what is not a product, and the ones there are", () => {
    const parsed = parseToolsets("gmail, mail");
    expect(parsed).toEqual({ problem: expect.stringMatching(/^mail is not a product; choose from gmail, calendar/) });
  });
});

describe("what a choice of products needs", () => {
  it("runs Docs, Sheets, Slides and collaboration on one editors grant", () => {
    expect(consentProductsOf(["docs"])).toEqual(["editors"]);
    expect(consentProductsOf(["collaboration", "gmail", "sheets"])).toEqual(["gmail", "editors"]);
    expect(consentProductsOf(ALL_TOOLSETS)).toEqual(["gmail", "calendar", "editors", "drive", "tasks", "contacts", "meet"]);
  });

  it("enables each API once, the editors' four together", () => {
    expect(apisOf(["gmail", "calendar"])).toEqual(["gmail.googleapis.com", "calendar-json.googleapis.com"]);
    expect(apisOf(["editors", "drive"])).toEqual(["docs.googleapis.com", "sheets.googleapis.com", "slides.googleapis.com", "drive.googleapis.com"]);
  });

  it("declares exactly the scopes the consents ask for, optional ones included, and userinfo.email", () => {
    expect(scopesOf(["gmail", "calendar"])).toEqual([
      `${S}gmail.modify`,
      `${S}gmail.settings.basic`,
      `${S}calendar.events`,
      `${S}calendar.calendarlist.readonly`,
      `${S}calendar.events.freebusy`,
      `${S}userinfo.email`,
    ]);
    expect(scopesOf(["contacts"])).toEqual([...CONSENT_SCOPES.contacts.required, `${S}directory.readonly`, `${S}userinfo.email`]);
  });
});

describe("parseLabels", () => {
  it("takes commas or spaces, once each", () => {
    expect(parseLabels("personal, work work")).toEqual({ ok: ["personal", "work"] });
  });

  it("refuses what cannot name a folder, and `state`, the cache folder beside the grants", () => {
    expect(parseLabels("Work")).toHaveProperty("problem");
    expect(parseLabels("../x")).toHaveProperty("problem");
    expect(parseLabels("state")).toEqual({ problem: expect.stringContaining("state") });
    expect(parseLabels(" ")).toHaveProperty("problem");
  });
});

describe("consentSteps", () => {
  it("goes account by account, and asks Drive's one grant only for the account it should reach", () => {
    expect(consentSteps(["gmail", "drive"], ["personal", "work"], "work")).toEqual([
      { product: "gmail", account: "personal" },
      { product: "gmail", account: "work" },
      { product: "drive", account: "work" },
    ]);
    expect(consentSteps(["drive"], ["personal", "work"], undefined)).toEqual([{ product: "drive", account: "personal" }]);
  });
});

describe("project IDs and console links", () => {
  it("makes IDs Google accepts", () => {
    for (let i = 0; i < 50; i++) expect(newProjectId()).toMatch(PROJECT_ID);
    expect(PROJECT_ID.test("my-project-1")).toBe(true);
    expect(PROJECT_ID.test("1abcdef")).toBe(false);
    expect(PROJECT_ID.test("abc")).toBe(false);
    expect(PROJECT_ID.test("abcdef-")).toBe(false);
  });

  it("pins every page to the project", () => {
    const links = consoleLinks("my-project-1", ["gmail.googleapis.com", "calendar-json.googleapis.com"]);
    expect(links.enableApis).toBe("https://console.cloud.google.com/apis/enableflow?apiid=gmail.googleapis.com,calendar-json.googleapis.com&project=my-project-1");
    expect(Object.values(links).every((l) => l.endsWith("project=my-project-1"))).toBe(true);
  });
});

describe("installLines", () => {
  it("sets no variable with every product and the default locations", () => {
    const { claudeCode, desktop } = installLines(ALL_TOOLSETS, []);
    expect(claudeCode).toBe("claude mcp add google -- npx -y @foreverworks/mcp-google");
    expect(JSON.parse(desktop)).toEqual({ mcpServers: { google: { command: "npx", args: ["-y", "@foreverworks/mcp-google"] } } });
  });

  it("passes a subset of products as GOOGLE_TOOLSETS, and the locations setup was told to use", () => {
    const carried = carriedVariables({ GOOGLE_STATE_DIR: "/srv/my state", HOME: "/home/ana", GMAIL_ADDRESSES: " " });
    expect(carried).toEqual([["GOOGLE_STATE_DIR", "/srv/my state"]]);
    const { claudeCode, desktop } = installLines(["gmail", "calendar"], carried);
    expect(claudeCode).toBe("claude mcp add google -e GOOGLE_TOOLSETS=gmail,calendar -e GOOGLE_STATE_DIR='/srv/my state' -- npx -y @foreverworks/mcp-google");
    expect(JSON.parse(desktop).mcpServers.google.env).toEqual({ GOOGLE_TOOLSETS: "gmail,calendar", GOOGLE_STATE_DIR: "/srv/my state" });
  });
});
