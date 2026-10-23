import { readConfigFile, unsetPath } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { configError, fail } from "../domain/errors.js";

/**
 * ANAF's public endpoints.
 *
 * Constants rather than configuration, because they are the same for every
 * taxpayer in the country and a deployment that got one wrong would fail in a
 * way that looks like a credential problem. app.json may still override them,
 * which is what makes a sandbox or a future path change a config edit rather
 * than a release.
 *
 * e-Transport: `https://api.anaf.ro/{prod|test}/ETRANSPORT/ws/v1/lista/{zile}/{cif}`,
 * per ANAF's "Serviciile Etransport" (etransport_29072024.pdf) and the path in
 * its own 404 example (lista.html).
 */
export const ANAF = {
  authorize: "https://logincert.anaf.ro/anaf-oauth2/v1/authorize",
  token: "https://logincert.anaf.ro/anaf-oauth2/v1/token",
  hello: "https://api.anaf.ro/TestOauth/jaxrs/hello",
  fctelProd: "https://api.anaf.ro/prod/FCTEL/rest",
  fctelTest: "https://api.anaf.ro/test/FCTEL/rest",
  etransportProd: "https://api.anaf.ro/prod/ETRANSPORT/ws/v1",
  etransportTest: "https://api.anaf.ro/test/ETRANSPORT/ws/v1",
} as const;

export type Endpoints = { readonly [K in keyof typeof ANAF]: string };

/**
 * ANAF's services that need no grant: e-Factura's validation and XML-to-PDF
 * conversion on the public host, and the VAT registry.
 *
 * Constants that app.json cannot override, on purpose: these tools work
 * without app.json and without a live grant, which is the point of them (a
 * PDF or a company check should not stop working the day the grant expires).
 *
 * - validare, transformare: the same operations as `api.anaf.ro/prod/FCTEL/rest`
 *   (validare.html, xmltopdf.html), which answers 401 without a bearer token.
 *   Measured 2026-09-30: the public host validates and converts without one.
 * - signature: /api/validate/signature (validaresemnatura.html), ANAF's own
 *   check of its seal on an invoice. Measured 2026-09-30: public as well.
 * - vatRegistry: PlatitorTvaRest v9, per ANAF's doc_WS_V9.txt
 *   (static.anaf.ro/static/10/Anaf/Informatii_R/Servicii_web/doc_WS_V9.txt):
 *   POST, at most 100 CUIs a request, at most one request a second.
 */
export const ANAF_PUBLIC = {
  fctel: "https://webservicesp.anaf.ro/prod/FCTEL/rest",
  signature: "https://webservicesp.anaf.ro/api/validate/signature",
  vatRegistry: "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva",
} as const;

export type AppConfig = {
  readonly appName: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUris: readonly string[];
  /** The CIF every tool defaults to. Optional: a grant may cover several. */
  readonly cif?: string | undefined;
  readonly endpoints: Endpoints;
};

const text = z.string().min(1);

/**
 * app.json, the OAuth app registration a human wrote once: `endpoints` holds
 * overrides by name (`authorize`, `token`, ...), and the FCTEL bases sit at the
 * TOP level as `api_base` / `api_test_base`.
 */
const appJson = z.object({
  app_name: text.optional(),
  client_id: text,
  client_secret: text,
  redirect_uris: z.array(text).optional(),
  company_cif: text.optional(),
  cif: text.optional(),
  api_base: text.optional(),
  api_test_base: text.optional(),
  endpoints: z.record(z.string(), z.unknown()).optional(),
});

const override = (overrides: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const value = overrides[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

/**
 * Reads app.json, which is READ-ONLY here: under systemd it lives in a
 * credentials directory, and nothing in this server writes beside it (see
 * paths.ts). The client secret never leaves this module except as HTTP Basic
 * auth on the token endpoint. `ANAF_CONFIG` names it and has no default.
 */
export const loadConfig = async (path: string | undefined): Promise<AppConfig> => {
  if (path === undefined) return fail(configError(unsetPath("ANAF_CONFIG")));
  // Named by field, never quoted: the file holds the client secret (the kit's readConfigFile).
  const c = await readConfigFile(path, appJson, (message) => fail(configError(message)));
  const overrides = c.endpoints ?? {};
  const pick = (key: keyof typeof ANAF): string => override(overrides, key) ?? ANAF[key];
  return {
    appName: c.app_name ?? "anaf-efactura",
    clientId: c.client_id,
    clientSecret: c.client_secret,
    redirectUris: c.redirect_uris ?? [],
    // `company_cif` is the documented name; `cif` is accepted because someone
    // writing the file by hand reaches for it.
    cif: c.company_cif ?? c.cif,
    endpoints: {
      authorize: pick("authorize"),
      token: pick("token"),
      hello: pick("hello"),
      // Top-level first: ignoring them would silently fall back to the
      // constants and make a deliberate override look applied.
      fctelProd: c.api_base ?? pick("fctelProd"),
      fctelTest: c.api_test_base ?? pick("fctelTest"),
      etransportProd: pick("etransportProd"),
      etransportTest: pick("etransportTest"),
    },
  };
};
