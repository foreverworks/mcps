import { z } from "zod";

import { completeAuth, revokeSession, startAuth } from "../../app/usecases/auth.js";
import { CONSENT_DAYS } from "../../domain/dates.js";
import type { PsuType } from "../../domain/schema.js";
import { handled } from "../envelope.js";
import { START_AUTH_INPUT } from "../startAuthArgs.js";
import type { Registrar } from "./types.js";

export const registerAuth: Registrar = (server, deps) => {
  server.registerTool(
    "start_auth",
    {
      title: "Begin a bank consent",
      description:
        `Begin a consent with one bank, valid for ${CONSENT_DAYS} days, over every account the bank offers. ` +
        "To renew a stored consent, pass the bank, country and psu_type list_stored_sessions shows for it. " +
        "Returns a URL a HUMAN must open: the bank requires strong customer authentication, so this step " +
        "cannot be automated. After approval the bank redirects to the configured redirect_url with ?code=... " +
        "in the query; that URL, or just the code, goes into complete_auth.",
      inputSchema: START_AUTH_INPUT,
    },
    handled((args: { aspsp_name: string; aspsp_country: string; psu_type: PsuType; state: string }) =>
      startAuth(deps, {
        aspspName: args.aspsp_name,
        aspspCountry: args.aspsp_country,
        psuType: args.psu_type,
        state: args.state,
      }),
    ),
  );

  server.registerTool(
    "complete_auth",
    {
      title: "Finish a bank consent",
      description:
        "Exchange the code from the bank's redirect for a session and store it under label, replacing the consent " +
        "stored there (the previous sessions.json is copied to sessions.json.bak first); without a label, a " +
        "renewal replaces the stored consent for the same bank, country and psu_type. Takes the WHOLE redirect " +
        "URL or just its code. The code is single-use and expires within minutes, so run this straight after the " +
        "approval. The session is written to disk before anything else, because Enable Banking reveals the session " +
        "id exactly once. Returns the authorised accounts (IBAN, currency, name, as the bank describes them now) " +
        "and when the consent ends.",
      inputSchema: {
        code_or_url: z.string().describe("The full redirect URL (...?code=...&state=...), or the code value alone."),
        label: z
          .string()
          .optional()
          .describe(
            "What to store it under: a-z, 0-9, _ and -. Default: the label of the stored consent for the same bank, " +
              "country and psu_type (a renewal replaces it), else the bank and country, like example_bank_de.",
          ),
      },
    },
    handled((args: { code_or_url: string; label?: string | undefined }) =>
      completeAuth(deps, { codeOrUrl: args.code_or_url, label: args.label }),
    ),
  );

  server.registerTool(
    "revoke_session",
    {
      title: "Revoke a bank consent",
      description:
        "End a stored consent: Enable Banking is asked to close the session, which ends the bank's consent, and " +
        "the label is removed from the stored consents (the file as it was is kept as a backup). Afterwards " +
        "nothing can read those accounts until the account holder approves a new consent in their bank, so use " +
        "it only when access should really stop (an account closed, an application retired, access no longer " +
        "wanted). A consent the bank already ended is removed just the same. The label is required, always.",
      inputSchema: {
        label: z.string().describe("The consent to end, as list_stored_sessions names it."),
      },
    },
    handled((args: { label: string }) => revokeSession(deps, { label: args.label })),
  );
};
