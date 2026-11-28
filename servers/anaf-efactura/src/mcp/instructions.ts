import type { Mode } from "../app/ports.js";
import { type Toolset, TOOLSET_NAMES } from "./toolsets.js";

/** What every deployment is told, with every toolset loaded: the whole server, its flow and its one money step. */
export const FULL_INSTRUCTIONS =
  "ANAF's e-Factura and e-Transport for one company: the invoices it received and sent, with their archives, PDFs and contents, " +
  "ANAF's own validation, the VAT registry, and filing. Start with health: whether the grant works, for which CIF, and for how many" +
  " more days. To issue an invoice: build_invoice, validate_invoice, then upload_invoice (to a company) or upload_invoice_b2c (to a" +
  " person), and upload_status. Filing is money, and every filing tool goes to ANAF's test environment unless test is false. When " +
  "the grant nears its end, refresh_token renews it; if that fails, begin_authorization needs the certificate holder.";

/** What a server with no ANAF grant is told: what it can do for anyone, and what it cannot. */
const GRANTLESS_INSTRUCTIONS =
  "ANAF's public e-Factura services, with no sign-in and no company behind them: look up companies in the VAT registry " +
  "(lookup_company), build a CIUS-RO invoice from fields (build_invoice), have ANAF validate one (validate_invoice) or render its " +
  "PDF (invoice_pdf), read one as JSON (parse_invoice) and check ANAF's seal on one (verify_signature). Start with health, which " +
  "says whether ANAF's public services answer. Nothing is filed with ANAF, no company's own invoices can be read, and a file a " +
  "tool makes comes back attached to the answer, not saved anywhere. For filing and a company's invoices, a person runs this " +
  "server themselves with their own ANAF grant.";

/**
 * What the server tells a client at initialize. With every toolset, the text
 * every deployment has always had. With only the toolsets that need no grant,
 * the text above. With any other subset, the full text and a last sentence
 * that names what is not loaded: a description or an error may name a tool of
 * another toolset, and a model that knows it is absent says so instead of
 * looking for a way around.
 */
export const instructionsFor = (loaded: readonly Toolset[], mode: Mode): string => {
  if (mode.grantless) return GRANTLESS_INSTRUCTIONS;
  const absent = TOOLSET_NAMES.filter((toolset) => !loaded.includes(toolset));
  if (absent.length === 0) return FULL_INSTRUCTIONS;
  return (
    `${FULL_INSTRUCTIONS} This server loads only the toolsets ${loaded.join(", ")} (ANAF_EFACTURA_TOOLSETS), with health always there. ` +
    `The tools of ${absent.join(", ")} are not on this server, even where a description or an error names one: when a request needs one, tell the user which toolset it takes.`
  );
};
