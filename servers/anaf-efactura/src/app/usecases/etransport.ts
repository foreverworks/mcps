import { declarationListing } from "../../domain/etransport.js";
import { parseDays } from "../../domain/window.js";
import { resolveCif } from "../cif.js";
import type { Deps } from "../ports.js";

/**
 * e-Transport declarations, which live behind a different base URL and a
 * different API version to e-Factura despite sharing the OAuth grant. The
 * `ETRANSPORT` role has to be on the grant separately; without it ANAF answers
 * 403 rather than an empty list.
 *
 * The rows are transport declarations, not e-Factura messages, so they map
 * through their own pure function.
 */
export const listEtransport = async (deps: Deps, args: { zile: number; cif: string; test: boolean }) =>
  declarationListing(
    await deps.anaf.etransportList({
      cif: await resolveCif(deps, args.cif),
      zile: parseDays(args.zile),
      test: args.test,
    }),
  );
