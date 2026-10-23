import { z } from "zod";

import { awaitReply, downloadMessage, listMessages, syncMessages } from "../../app/usecases/messages.js";
import { postingDates } from "../../app/usecases/postings.js";
import { isoDate, saveDir, selection } from "../args.js";
import type { Registrar } from "./types.js";

const blank = (value: string): string | undefined => (value.trim() === "" ? undefined : value);

export const registerMessages: Registrar = (server, deps, handled) => {
  server.registerTool(
    "list_messages",
    {
      title: "List messages",
      description:
        "SPV's message list (\"Mesaje\"): every document ANAF has put in the taxpayer's virtual space and not yet archived, newest first: decisions, " +
        "summonses (SOMATII), notifications, payment confirmations (PLATA), receipts, and the answers to requests (RASPUNS SOLICITARE, with the " +
        "request's id). Each has a `key` for download_message, the time SPV posted it (deadlines usually run from there) and the time it will be " +
        "archived, after which it can no longer be downloaded. `types` counts every type in the whole list.",
      inputSchema: {
        ...selection,
        request_id: z.string().trim().min(1).optional().describe("Only the answer to this request (request_document's request_id)."),
        text: z.string().trim().min(1).optional().describe("Only messages whose details contain this phrase (case and diacritics ignored)."),
        limit: z.number().int().min(1).max(500).default(50).describe("At most this many items; `more` says how many were left out."),
      },
    },
    handled((args) => listMessages(deps, { type: args.type, since: args.since, until: args.until, cif: args.cif, requestId: args.request_id, text: args.text, limit: args.limit })),
  );

  server.registerTool(
    "download_message",
    {
      title: "Download a message",
      description:
        "Download one message's document (a signed PDF, as SPV serves it) into the downloads outbox, named <posted date>_<type>_<SPV's file name>. " +
        "Answers the path, size and SHA-256. Saving the same bytes again finds them there (already_there) instead of writing a copy. A file SPV names " +
        "for another message (another request's id) is refused as wrong_document and not saved.",
      inputSchema: {
        key: z.string().trim().min(1).describe("The message's key, from list_messages."),
        save_dir: saveDir,
      },
    },
    handled((args) => downloadMessage(deps, { key: args.key, saveDir: blank(args.save_dir) })),
  );

  server.registerTool(
    "sync_messages",
    {
      title: "Save every new message",
      description:
        "Download every message this server has not saved before (oldest first) and remember it, so a scheduled call keeps a complete archive: " +
        "SPV drops most documents about two months after posting them. Filters narrow what is synced; `limit` caps one call and `remaining` says " +
        "how many are left for the next. Answers what was saved, with paths and SHA-256. A client that asks for progress hears each document " +
        "saved; cancelling stops between documents, and the next sync carries on from there.",
      inputSchema: {
        ...selection,
        save_dir: saveDir,
        limit: z.number().int().min(1).max(200).default(50).describe("At most this many downloads in this call."),
      },
    },
    handled((args) => syncMessages(deps, { type: args.type, since: args.since, until: args.until, cif: args.cif, saveDir: blank(args.save_dir), limit: args.limit })),
  );

  server.registerTool(
    "posting_dates",
    {
      title: "When SPV posted documents",
      description:
        "When SPV posted documents, from its alert e-mails (\"Documente noi SPV\" from Portal.ANAF@anaf.ro) in the mailbox its sign-in codes go to: " +
        "per line the document (with its form, e.g. D256), the day ANAF processed it (\"prelucrata la\") and when the alert arrived, newest first. " +
        "SPV drops most documents about two months after posting them, and an act posted there counts as communicated on the day it was made " +
        "available, so for an archived document these alerts are the lasting record of that date. Reads mail only, never SPV. details matches " +
        "list_messages' details for a document still listed.",
      inputSchema: {
        since: isoDate("Alerts received on or after"),
        until: isoDate("Alerts received on or before"),
        text: z.string().trim().min(1).optional().describe("Only lines whose details contain this phrase (case and diacritics ignored), e.g. D256."),
        limit: z.number().int().min(1).max(500).default(100).describe("At most this many alert e-mails read."),
      },
    },
    handled((args) => postingDates(deps, { since: args.since, until: args.until, text: args.text, limit: args.limit })),
  );

  server.registerTool(
    "await_reply",
    {
      title: "Wait for a request's reply",
      description:
        "Wait for SPV's answer to a request_document (a RASPUNS SOLICITARE message carrying its id), checking the list every few seconds for up " +
        "to wait_seconds. SPV usually answers within two minutes. With download, the answer's document is saved to the outbox as download_message " +
        "saves it. answered: false means not yet; call again. A client that asks for progress hears the seconds waited; cancelling ends the wait.",
      inputSchema: {
        request_id: z.string().trim().min(1).describe("The request_id request_document returned."),
        wait_seconds: z.number().int().min(0).max(120).default(90).describe("How long to keep checking; 0 checks once."),
        download: z.boolean().default(true).describe("Save the answer's document to the outbox when it is there."),
        save_dir: saveDir,
      },
    },
    handled((args) => awaitReply(deps, { requestId: args.request_id, waitSeconds: args.wait_seconds, download: args.download, saveDir: blank(args.save_dir) })),
  );
};
