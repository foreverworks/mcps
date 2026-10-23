import { z } from "zod";

import {
  checkHealth,
  listClients,
  listCompanies,
  listProducts,
  listSeries,
  listVatRates,
  PAGE_SIZE,
} from "../../app/usecases/nomenclature.js";
import { compact } from "@foreverworks/mcp-kit";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

const offset = z
  .number()
  .int()
  .min(0)
  .default(0)
  .describe(`Oblio answers ${PAGE_SIZE} rows a page; pass the nextOffset a full page reports to read the next.`);
const limit = z.number().int().min(1).max(PAGE_SIZE).default(PAGE_SIZE).describe("Return at most this many rows of the page.");
/** An empty filter is no filter, not a search for the empty string. */
const filter = (what: string) => z.string().trim().max(120).optional().describe(what);
const given = (value: string | undefined): string | undefined => (value === undefined || value === "" ? undefined : value);

const CACHED = " Remembered for 10 minutes; `asOf` says when it was read from Oblio.";

export const registerNomenclature: Registrar = (server, deps) => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Check that the integration is alive and say so in detail: the Oblio account, the company CIF every call " +
        "acts on, whether that CIF is one this account can actually reach, and the companies it can. Always asks " +
        "Oblio, never the cache. Run this before concluding the MCP is broken.",
      inputSchema: {},
    },
    handled(() => checkHealth(deps)),
  );

  server.registerTool(
    "list_companies",
    {
      title: "List companies",
      description:
        "The companies this Oblio account is attached to. Only the one whose CIF is in app.json is acted on; this is " +
        `how you check that the right one is configured.${CACHED}`,
      inputSchema: {},
    },
    handled(() => listCompanies(deps)),
  );

  server.registerTool(
    "list_clients",
    {
      title: "List clients",
      description: "The company's saved clients, optionally filtered by name or by the client's own CIF. Never cached.",
      inputSchema: { name: filter("Part of the client's name."), client_cif: filter("The client's CIF."), offset, limit },
    },
    handled((args: { name?: string | undefined; client_cif?: string | undefined; offset: number; limit: number }) =>
      listClients(deps, {
        offset: args.offset,
        limit: args.limit,
        ...compact({ name: given(args.name), clientCif: given(args.client_cif) }),
      }),
    ),
  );

  server.registerTool(
    "list_products",
    {
      title: "List products",
      description: "The company's saved products and services, optionally filtered by name or code. Never cached.",
      inputSchema: { name: filter("Part of the product's name."), code: filter("The product's code."), offset, limit },
    },
    handled((args: { name?: string | undefined; code?: string | undefined; offset: number; limit: number }) =>
      listProducts(deps, {
        offset: args.offset,
        limit: args.limit,
        ...compact({ name: given(args.name), code: given(args.code) }),
      }),
    ),
  );

  server.registerTool(
    "list_series",
    {
      title: "List document series",
      description:
        "The document series configured for the company, with the number each will issue next. Every issuing tool " +
        `needs one of these names. Forgotten after any document this server issues or deletes.${CACHED}`,
      inputSchema: {},
    },
    handled(() => listSeries(deps)),
  );

  server.registerTool(
    "list_vat_rates",
    {
      title: "List VAT rates",
      description: `The VAT rates available to the company: a line's vat_name and vat_percentage come from here.${CACHED}`,
      inputSchema: {},
    },
    handled(() => listVatRates(deps)),
  );
};
