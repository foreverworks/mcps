/**
 * What every tool is allowed to do, declared by the server that owns it.
 *
 * A server hands `serve` a policy naming EVERY tool it registers, and `serve`
 * refuses to start if one is missing. That makes the classification impossible
 * to forget: a new tool cannot ship unclassified, and the annotations a client
 * sees, the audit line and the ceiling all read the same map.
 *
 * - `read`: no effect outside this server.
 * - `write`: an effect, reversible or not, that is not money or law (a draft,
 *   a label, a calendar event, a document edit, a sent mail).
 * - `money`: money moves or a legal document is made or unmade (an invoice
 *   issued or cancelled, an e-Factura upload, a bank consent, a domain bought).
 *   A client should ask its user before each one (the tool's annotations say
 *   so); a deployment can also have the server ask, with the one line the
 *   server provides here (MCP_CONFIRM, serve/confirm.ts).
 *
 * A `write` may also be marked `confirm`: the same confirmation, for an effect
 * a person must see coming although nothing is paid or signed.
 */

export type Access = "read" | "write" | "money";

export type ToolArgs = Readonly<Record<string, unknown>>;

/** What a person is shown before a call runs, and the arguments it runs on. */
export type Confirmation = {
  /**
   * ONE line for the user, at most 300 characters and no newline: exactly
   * what happens if they confirm (for money: counterparty, amount and
   * currency, document, account). Computed from the validated arguments, with
   * the same domain functions the call itself uses.
   */
  readonly summary: (args: ToolArgs) => string;
  /**
   * The arguments as the user confirms them and the tool runs on, for a
   * tool that names something whose content can change after the line was
   * written: a file given by path. Read here once per call, so the line
   * and the call see the same bytes. A failure here fails the call before
   * anyone is asked. Without it: the arguments as they came.
   */
  readonly resolve?: (args: ToolArgs) => Promise<ToolArgs>;
};

/**
 * A write that may declare itself idempotent: calling it again with the same
 * arguments changes nothing more (a label set, a message trashed, a revision
 * kept). It becomes the tool's `idempotentHint`, which a client may read as
 * leave to retry, so a wrong one invites a duplicate: undeclared means false,
 * and each declared tool has a test that runs it twice and finds no second
 * effect (`idempotentWrites` lists them for that test).
 */
type MaybeIdempotent = { readonly idempotent?: true };

export type ToolRule =
  | { readonly access: "read"; readonly confirm?: undefined; readonly idempotent?: undefined }
  | ({ readonly access: "write"; readonly confirm?: undefined } & MaybeIdempotent)
  /**
   * A write a person approves call by call, though no money moves: one that
   * acts on the physical world (paper through a printer, a scanner's lamp
   * over whatever lies on its glass). Confirmed exactly like money
   * (MCP_CONFIRM), and still a write for the ceiling.
   */
  | ({ readonly access: "write"; readonly confirm: true } & MaybeIdempotent & Confirmation)
  /** Never idempotent here: a money call is not one a client may repeat on its own. */
  | ({ readonly access: "money"; readonly idempotent?: undefined } & Confirmation);

/** A rule whose every call needs a person's yes: money, or a write marked `confirm`. */
export type ConfirmedRule = Extract<ToolRule, Confirmation>;

export const needsPerson = (rule: ToolRule): rule is ConfirmedRule => rule.access === "money" || rule.confirm === true;

export type ToolPolicy = Readonly<Record<string, ToolRule>>;

/** Whether calling the tool twice with the same arguments has no more effect than once: every read, and a write that declares it. */
export const isIdempotent = (rule: ToolRule): boolean => rule.access === "read" || (rule.access === "write" && rule.idempotent === true);

/** The writes a policy declares idempotent, in name order: each needs a test that calls it twice. */
export const idempotentWrites = (policy: ToolPolicy): readonly string[] =>
  Object.entries(policy)
    .filter(([, rule]) => rule.access === "write" && rule.idempotent === true)
    .map(([name]) => name)
    .sort();

/** Anything with zod's safeParse, so the kit does not pin a schema library for its callers. */
type Parser<T> = { readonly safeParse: (value: unknown) => { success: true; data: T } | { success: false } };

/**
 * A money summary computed from TYPED arguments: parsed with the tool's own
 * schema (the SDK already validated them, so this always succeeds in practice)
 * and handed to the same domain function the call itself uses. If the parse or
 * the line fails, the user is told the call will be refused rather than shown
 * a guess.
 */
export const summaryFrom =
  <T>(schema: Parser<T>, line: (args: T) => string) =>
  (args: ToolArgs): string => {
    const refused = "a call whose arguments do not validate; it will be refused before it reaches the service";
    const parsed = schema.safeParse(args);
    if (!parsed.success) return refused;
    try {
      return line(parsed.data);
    } catch {
      return refused;
    }
  };

/** The tools a server registered that its policy does not name. */
export const unclassified = (policy: ToolPolicy, registered: readonly string[]): readonly string[] =>
  registered.filter((name) => !Object.hasOwn(policy, name));

/** Merge product policies into one; a tool named twice is a startup error, not a silent override. */
export const mergePolicies = (...policies: readonly ToolPolicy[]): ToolPolicy => {
  const names = policies.flatMap((p) => Object.keys(p));
  const twice = names.filter((name, i) => names.indexOf(name) !== i);
  if (twice.length > 0) throw new Error(`tools classified twice: ${[...new Set(twice)].join(", ")}`);
  return Object.freeze(Object.assign({}, ...policies) as ToolPolicy);
};
