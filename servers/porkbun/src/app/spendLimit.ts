import { issuesText } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { CAP_CODE, type Cap, type CapState, capFigures, chargeOf, overCap } from "../domain/charges.js";
import { asAppError, fail } from "../domain/errors.js";
import type { Deps, ToolArgs } from "./ports.js";

/**
 * The account's monthly API caps, checked before a call that charges now.
 *
 * Porkbun enforces them itself (MONTHLY_SPEND_LIMIT_EXCEEDED,
 * TOPUP_LIMIT_EXCEEDED), but only once the call reaches it; a paid card hold
 * or a USDC checkout may already be open by then. Here the caps are read
 * first (get_api_settings, the vendor's own tool, so its key and its errors
 * are handled the same way) and a charge over what is left is refused with
 * the figures, before anything is sent. A charge within them is sent as it
 * is, and Porkbun's own check still runs.
 */

const cents = z.number().int().refine(Number.isSafeInteger, "a whole number of cents");

/** GET /account/apiSettings: `spendLimit` and `topupLimit`, the caps Porkbun actually enforces. */
const CapSchema = z.looseObject({
  source: z.enum(["account", "default", "none"]),
  limit: cents.nullish(),
  spent: cents.nullish(),
  added: cents.nullish(),
  remaining: cents.nullish(),
});
const SettingsSchema = z.looseObject({ spendLimit: CapSchema, topupLimit: CapSchema });

type CapAnswer = z.infer<typeof CapSchema>;

const drift = (message: string): never => fail({ kind: "drift", message: `get_api_settings: ${message}; nothing was sent to Porkbun` });

/** What a cap answer says: no cap, or the limit and how much of it this month already used. */
const capState = (cap: Cap, answer: CapAnswer): CapState => {
  if (answer.source === "none") return { capped: false };
  const used = cap === "spend" ? answer.spent : answer.added;
  const { limit } = answer;
  if (limit == null || used == null) return drift(`${cap}Limit is capped (${answer.source}) but has no limit or ${cap === "spend" ? "spent" : "added"}`);
  // Porkbun reports `remaining` for purchases (it holds the amount of an order in progress); top-ups report only what was added.
  const remaining = cap === "spend" ? answer.remaining : limit - used;
  if (remaining == null) return drift("spendLimit is capped but has no remaining");
  return { capped: true, source: answer.source, limit, used, remaining };
};

/** get_api_settings' answer; a failure says it happened on the read before `tool`, which was not sent. */
const settingsBefore = async (deps: Deps, tool: string): Promise<unknown> => {
  try {
    return await deps.porkbun.run("get_api_settings", {});
  } catch (thrown: unknown) {
    const known = asAppError(thrown);
    if (known === undefined) throw thrown;
    return fail({ ...known, message: `get_api_settings, read before ${tool}: ${known.message}; ${tool} was not sent` });
  }
};

/** Reads both caps; an answer this server cannot read refuses the charge rather than guessing it fits. */
export const readCaps = async (deps: Deps, tool: string): Promise<Readonly<Record<Cap, CapState>>> => {
  const parsed = SettingsSchema.safeParse(await settingsBefore(deps, tool));
  if (!parsed.success) return drift(`the answer is not the spend controls this server reads: ${issuesText(parsed.error)}`);
  return { spend: capState("spend", parsed.data.spendLimit), topup: capState("topup", parsed.data.topupLimit) };
};

/** Refuses the call, with Porkbun's code and the figures, when it would charge more than is left of its cap; otherwise returns. */
export const checkSpendLimit = async (deps: Deps, tool: string, args: ToolArgs): Promise<void> => {
  const charge = chargeOf(tool, args);
  if (charge === undefined) return;
  const state = (await readCaps(deps, tool))[charge.cap];
  const message = overCap(tool, charge, state);
  if (message === undefined || !state.capped) return;
  fail({ kind: "over_limit", message, code: CAP_CODE[charge.cap], cap: charge.cap, figures: capFigures(charge, state) });
};
