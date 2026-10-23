import { z } from "zod";

import { listLabels } from "../../app/usecases/labels.js";
import { createLabel, deleteLabel, type LabelInput, updateLabel } from "../../app/usecases/organize.js";
import { handled } from "../envelope.js";
import { accountArg, writeAccountArg } from "./account.js";
import type { Registrar } from "./types.js";

const labelShape = {
  label_list_visibility: z.enum(["labelShow", "labelShowIfUnread", "labelHide"]).optional().describe("In the label list on the left."),
  message_list_visibility: z.enum(["show", "hide"]).optional().describe("On messages in the message list."),
  background_color: z.string().optional().describe("Hex from Gmail's fixed palette, e.g. #16a766. Needs text_color too."),
  text_color: z.string().optional().describe("Hex from Gmail's fixed palette, e.g. #ffffff."),
};

type LabelArgs = {
  name?: string | undefined;
  label_list_visibility?: string | undefined;
  message_list_visibility?: string | undefined;
  background_color?: string | undefined;
  text_color?: string | undefined;
};

const labelInput = (a: LabelArgs): LabelInput => ({
  ...(a.name !== undefined ? { name: a.name } : {}),
  ...(a.label_list_visibility ? { labelListVisibility: a.label_list_visibility } : {}),
  ...(a.message_list_visibility ? { messageListVisibility: a.message_list_visibility } : {}),
  ...(a.background_color ? { backgroundColor: a.background_color } : {}),
  ...(a.text_color ? { textColor: a.text_color } : {}),
});

export const registerLabels: Registrar = (server, registry) => {
  server.registerTool(
    "list_labels",
    {
      title: "List labels",
      description: "List Gmail labels (system and user-defined) for one account.",
      inputSchema: { account: accountArg() },
    },
    handled((args: { account: string }) => listLabels(registry.get(args.account))),
  );

  server.registerTool(
    "create_label",
    {
      title: "Create label",
      description: "Create a user label. Nest it under another with a slash in the name, e.g. 'Clients/Acme'.",
      inputSchema: { name: z.string(), ...labelShape, account: writeAccountArg() },
    },
    handled((args: LabelArgs & { account: string }) => createLabel(registry.get(args.account), labelInput(args))),
  );

  server.registerTool(
    "update_label",
    {
      title: "Update label",
      description: "Rename or restyle a user label, given by id or name. System labels (INBOX, SENT, ...) are refused.",
      inputSchema: { label: z.string().describe("Id or current name."), name: z.string().optional().describe("New name."), ...labelShape, account: writeAccountArg() },
    },
    handled((args: LabelArgs & { label: string; account: string }) =>
      updateLabel(registry.get(args.account), args.label, labelInput(args)),
    ),
  );

  server.registerTool(
    "delete_label",
    {
      title: "Delete label",
      description:
        "Delete a user label, given by id or name. It is removed from every message that carries it; the messages " +
        "themselves are untouched. System labels are refused.",
      inputSchema: { label: z.string().describe("Id or name."), account: writeAccountArg() },
    },
    handled((args: { label: string; account: string }) => deleteLabel(registry.get(args.account), args.label)),
  );
};
