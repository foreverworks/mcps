import { compact } from "@foreverworks/mcp-kit";

import { alertLine } from "../../domain/alerts.js";
import { dateAt, isoAt } from "../../domain/dates.js";
import { folded } from "../../domain/messages.js";
import type { Deps } from "../ports.js";

/**
 * When SPV posted documents, from its alert e-mails: every line of every
 * alert in the range, newest first, with the alert's arrival. Reads mail
 * only, never SPV, so it answers for documents SPV has already archived.
 */
export const postingDates = async (deps: Deps, args: { readonly since: string | undefined; readonly until: string | undefined; readonly text: string | undefined; readonly limit: number }) => {
  const { mails, more } = await deps.alerts.read({ since: args.since, until: args.until, limit: args.limit });
  const inRange = (ms: number) => (args.since === undefined || dateAt(ms) >= args.since) && (args.until === undefined || dateAt(ms) <= args.until);
  const lines = mails
    .filter((m) => inRange(m.receivedAtMs))
    .flatMap((m) => m.lines.flatMap((text) => {
      const line = alertLine(text);
      return line === undefined ? [] : [{ ...line, alertAtMs: m.receivedAtMs, mailId: m.id }];
    }))
    .filter((l) => args.text === undefined || folded(l.details).includes(folded(args.text)))
    .sort((a, b) => b.alertAtMs - a.alertAtMs);
  return {
    ok: true as const,
    alerts: mails.filter((m) => inRange(m.receivedAtMs)).length,
    lines: lines.map((l) =>
      compact({ alert_at: isoAt(l.alertAtMs), document: l.document, form: l.form, processed_on: l.processedOn, details: l.details, mail_id: l.mailId }),
    ),
    ...(more ? { more: `there are more alerts than limit ${args.limit}: narrow since/until or raise limit` } : {}),
  };
};
