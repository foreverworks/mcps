import { unsetPath, writeFileAtomic } from "@foreverworks/mcp-kit";

import { fail, OUTBOX_VARIABLE } from "../domain/errors.js";
import { callTool } from "./callTool.js";
import type { Deps, ToolArgs } from "./ports.js";

/**
 * create_mailbox and setup_mailbox, with a password Porkbun generates kept
 * out of the conversation. Without `password` in the call, Porkbun makes one
 * and returns it once, in the answer's `password`; here it is written to the
 * outbox instead (`<address>.password`, owner and group only, as the TLS key
 * is), and the answer says where. So the outbox must be set before anything
 * is bought: once the mailbox exists, the password cannot be asked for again.
 */

/** Owner read and write, group read: the outbox's group is who may take files out of it. */
const PASSWORD_MODE = 0o640;

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);

/** The mailbox's address, from Porkbun's answer or the call, as a file name (`me@example.com.password`). */
const fileName = (answer: Readonly<Record<string, unknown>>, args: ToolArgs): string => {
  const given = text(args["address"]);
  const address = text(record(answer["mailbox"])?.["address"]) ?? (given?.includes("@") ? given : `${given ?? "mailbox"}@${String(args["domain"] ?? "")}`);
  return `${address.toLowerCase().replace(/[^a-z0-9@._+-]/g, "-")}.password`;
};

export const withPasswordSaved = async (deps: Deps, tool: string, args: ToolArgs, revealsSecrets: boolean): Promise<unknown> => {
  const generates = text(args["password"]) === undefined && args["dry_run"] !== true;
  if (generates && deps.outbox === undefined) {
    return fail({
      kind: "config",
      variable: OUTBOX_VARIABLE,
      message: `${unsetPath(OUTBOX_VARIABLE)}: the password Porkbun generates is shown once and saved there, so ${tool} was not sent`,
    });
  }
  const result = await callTool(deps, tool, args, revealsSecrets);
  const answer = record(result);
  const password = answer === undefined ? undefined : answer["password"];
  if (answer === undefined || typeof password !== "string" || deps.outbox === undefined) return result;
  const { password: _secret, ...rest } = answer;
  try {
    const path = await writeFileAtomic(deps.outbox, fileName(answer, args), `${password}\n`, { mode: PASSWORD_MODE });
    return { ...rest, password: { saved: path, mode: "0640", note: "Porkbun shows it once; move it to a password manager and delete the file" } };
  } catch (cause: unknown) {
    return { ...rest, password: { saved: false, note: `could not be saved (${(cause as Error).message}); set a new one with set_email_password` } };
  }
};
