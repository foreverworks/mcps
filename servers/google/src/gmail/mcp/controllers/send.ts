import { z } from "zod";

import { forward, reply, sendMessage } from "../../app/usecases/reply.js";
import { handled } from "../envelope.js";
import { writeAccountArg } from "./account.js";
import { type ComposeArgs, composeInput, composeShape, OUTWARD } from "./composeArgs.js";
import type { Registrar } from "./types.js";

const send = z
  .boolean()
  .default(false)
  .describe(`false (default) saves a DRAFT and returns its webUrl. true SENDS immediately. ${OUTWARD}`);

export const registerSend: Registrar = (server, registry) => {
  server.registerTool(
    "reply",
    {
      title: "Reply",
      description:
        "Answer a message, threaded properly for every party: the original's threadId, In-Reply-To and " +
        "References, a 'Re:' subject, and the recipients Gmail's own Reply picks (Reply-To when the original has " +
        "one, else From; a reply to a message you SENT goes to its recipients). Goes out from the alias the " +
        "original reached. Creates a DRAFT unless send is true. `to` replaces the computed recipients; `cc` and " +
        "`bcc` add to them.",
      inputSchema: {
        message_id: z.string().describe("The message being answered (from get_thread)."),
        reply_all: z.boolean().default(false).describe("Also address the original's To and Cc, minus this account's own addresses."),
        quote: z.boolean().default(true).describe(
            "Quote the original below the reply as Gmail's own Reply does, with the images the quote shows. In Gmail's conversation view the quote folds behind \"•••\"; with conversation view off Gmail shows every quote, its own included.",
          ),
        ...composeShape(registry.inputFiles),
        send,
        account: writeAccountArg(),
      },
    },
    handled((args: ComposeArgs & { message_id: string; reply_all: boolean; quote: boolean; send: boolean; account: string }) =>
      reply(registry.get(args.account), {
        ...composeInput(args),
        messageId: args.message_id,
        replyAll: args.reply_all,
        quote: args.quote,
        send: args.send,
      }),
    ),
  );

  server.registerTool(
    "forward",
    {
      title: "Forward",
      description:
        "Forward a message WITH its attachments, under Gmail's 'Forwarded message' block, with an optional note " +
        "above it (body_text / body_html). Creates a DRAFT unless send is true. Extra attachments can be added.",
      inputSchema: {
        message_id: z.string().describe("The message to forward (from get_thread)."),
        include_attachments: z.boolean().default(true).describe("Carry the original's attachments. Default true. The images its body shows travel either way."),
        ...composeShape(registry.inputFiles),
        send,
        account: writeAccountArg(),
      },
    },
    handled((args: ComposeArgs & { message_id: string; include_attachments: boolean; send: boolean; account: string }) =>
      forward(registry.get(args.account), {
        ...composeInput(args),
        messageId: args.message_id,
        includeAttachments: args.include_attachments,
        send: args.send,
      }),
    ),
  );

  server.registerTool(
    "send_message",
    {
      title: "Send message",
      description:
        `Send a NEW message immediately. ${OUTWARD} Prefer create_draft. To answer an existing message use reply, ` +
        "which threads it. Returns the sent message's webUrl.",
      inputSchema: { ...composeShape(registry.inputFiles), account: writeAccountArg() },
    },
    handled((args: ComposeArgs & { account: string }) => sendMessage(registry.get(args.account), composeInput(args))),
  );
};
