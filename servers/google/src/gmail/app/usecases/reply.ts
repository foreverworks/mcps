import { dedupe } from "../../domain/addresses.js";
import { buildMime, type Outgoing } from "../../domain/compose.js";
import { fullBodies, withForwarded, withQuote } from "../../domain/quote.js";
import {
  addressedAlias,
  forwardSubject,
  originalOf,
  replyRecipients,
  replySubject,
  threadHeaders,
} from "../../domain/threading.js";
import { inputError, fail } from "../../domain/errors.js";
import type { Deps } from "../ports.js";
import {
  attachmentFacts,
  attachmentsOf,
  bodiesOf,
  withinGuard,
  type ComposeInput,
  draftResult,
  fromOf,
  type Identity,
  identityOf,
  originalAttachments,
  recipients,
  sentResult,
  shownImages,
} from "./compose.js";
import { requireWrite } from "./writeGuard.js";
import { namedHeaders } from "../../domain/mime.js";

/**
 * Draft unless told otherwise. `send: true` is the outward-facing path, and
 * the tool descriptions say the user has to have approved that message.
 */
const deliver = async (deps: Deps, id: Identity, message: Outgoing, threadId: string | undefined, send: boolean) => {
  withinGuard([...message.attachments]);
  const raw = buildMime(message, deps.boundary);
  const facts = attachmentFacts(message.attachments, message.html);
  return send
    ? { ...sentResult(deps, id, await deps.write.sendMessage(raw, threadId)), ...facts }
    : { ...draftResult(deps, id, await deps.write.createDraft(raw, threadId)), sent: false, ...facts };
};

export type ReplyInput = ComposeInput & {
  readonly messageId: string;
  readonly replyAll: boolean;
  /** Quote the original under the reply, as Gmail's own Reply does, with the images the quote shows. */
  readonly quote: boolean;
  readonly send: boolean;
};

/**
 * A reply that threads everywhere: the original's threadId on the call, its
 * Message-ID in In-Reply-To, the chain in References, "Re:" once, and the
 * recipients Gmail's own Reply would pick (see domain/threading.ts).
 *
 * `to` REPLACES the computed recipients; `cc` and `bcc` ADD to them. That is the
 * split a caller wants: redirecting a reply is deliberate, copying someone in
 * is additive.
 */
export const reply = async (deps: Deps, input: ReplyInput) => {
  await requireWrite(deps);
  const [msg, id] = await Promise.all([deps.gmail.getMessage(input.messageId, { format: "full" }), identityOf(deps)]);
  const orig = originalOf(msg, namedHeaders(msg.payload));
  const computed = replyRecipients(orig, id.mine, input.replyAll);
  const to = input.to?.length ? recipients(input.to, "to") : computed.to;
  const cc = dedupe([...computed.cc, ...recipients(input.cc, "cc")], to.map((a) => a.email));
  const from = fromOf(id, input.from, addressedAlias(orig, id.mine));
  const own = bodiesOf(deps, input);
  const original = fullBodies(msg.payload);
  const bodies = input.quote ? withQuote(own, orig, original, deps) : own;
  const quotedImages = input.quote ? await shownImages(deps, msg, original.html) : [];

  return deliver(
    deps,
    id,
    {
      ...(from ? { from } : {}),
      to,
      cc,
      bcc: recipients(input.bcc, "bcc"),
      subject: input.subject ?? replySubject(orig.subject),
      ...bodies,
      attachments: [...quotedImages, ...(await attachmentsOf(deps, input.attachments))],
      ...threadHeaders(orig),
    },
    msg.threadId ?? undefined,
    input.send,
  );
};

export type ForwardInput = ComposeInput & {
  readonly messageId: string;
  /** The original's attachments travel with it unless this is false. */
  readonly includeAttachments: boolean;
  readonly send: boolean;
};

/**
 * The original below Gmail's "Forwarded message" block, WITH its attachments,
 * which is the half of a forward that is easy to lose. The images its body
 * shows travel even when the attachments do not: they are part of the body.
 * It stays in the original's conversation here, as Gmail's own Forward does.
 */
export const forward = async (deps: Deps, input: ForwardInput) => {
  await requireWrite(deps);
  const to = recipients(input.to, "to");
  if (to.length === 0) return fail(inputError("a forward needs at least one address in `to`"));
  const [msg, id] = await Promise.all([deps.gmail.getMessage(input.messageId, { format: "full" }), identityOf(deps)]);
  const orig = originalOf(msg, namedHeaders(msg.payload));
  const from = fromOf(id, input.from, addressedAlias(orig, id.mine));
  const note = input.bodyText !== undefined || input.bodyHtml !== undefined ? bodiesOf(deps, input) : {};
  const original = fullBodies(msg.payload);
  const images = await shownImages(deps, msg, original.html);
  const files = input.includeAttachments ? await originalAttachments(deps, msg) : [];
  const carried = [...images, ...files.filter((f) => !images.some((i) => i.contentId === f.contentId))];

  return deliver(
    deps,
    id,
    {
      ...(from ? { from } : {}),
      to,
      cc: recipients(input.cc, "cc"),
      bcc: recipients(input.bcc, "bcc"),
      subject: input.subject ?? forwardSubject(orig.subject),
      ...withForwarded(note, orig, original, deps),
      attachments: [...carried, ...(await attachmentsOf(deps, input.attachments))],
      ...threadHeaders(orig),
    },
    msg.threadId ?? undefined,
    input.send,
  );
};

/** A new message, sent now. Outward-facing: create_draft is the default path. */
export const sendMessage = async (deps: Deps, input: ComposeInput) => {
  await requireWrite(deps);
  const to = recipients(input.to, "to");
  const cc = recipients(input.cc, "cc");
  const bcc = recipients(input.bcc, "bcc");
  if (to.length + cc.length + bcc.length === 0) return fail(inputError("a message needs at least one recipient"));
  const id = await identityOf(deps);
  const from = fromOf(id, input.from);
  return deliver(
    deps,
    id,
    {
      ...(from ? { from } : {}),
      to,
      cc,
      bcc,
      subject: input.subject ?? "",
      ...bodiesOf(deps, input),
      attachments: await attachmentsOf(deps, input.attachments),
      references: [],
    },
    undefined,
    true,
  );
};
