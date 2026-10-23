import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { auditCredentials, setSubmitKey } from "../../app/usecases/credentials.js";
import { type ArgsOf, platform, project } from "../args.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

/** An App Store Connect key's Apple id (10 upper-case letters and digits), or its EAS id (a UUID). */
const KEY_ID = /^(?:[A-Z0-9]{10}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

const AUDIT = {
  project,
  platform,
  identifier: z.string().trim().min(1).optional().describe("One bundle id or package. Default: every one the project has credentials for or has built."),
};

const SET_KEY = {
  project,
  bundle_id: z.string().trim().min(1).describe("The iOS bundle id whose submissions use the key, e.g. com.example.app.dev."),
  key: z
    .string()
    .trim()
    .regex(KEY_ID, "a key is named by its 10-character Apple key id or its EAS id (a UUID)")
    .optional()
    .describe('The App Store Connect API key, by its 10-character Apple key id (e.g. "ABCDE12345") or its EAS id; the account must already hold it.'),
  clear: z.boolean().default(false).describe("Remove the key set for submissions instead (eas submit for this bundle then fails until one is set)."),
};

export const registerCredentials: Registrar = (server, deps) => {
  server.registerTool(
    "audit_credentials",
    {
      title: "Audit credentials",
      description:
        "Per bundle id (iOS) and package (Android) of a project: the distribution certificate and provisioning profile with their " +
        "expiry, the App Store Connect API key for submissions, the push key, the upload keystore's fingerprints and the Google " +
        "service account for submissions, and in words what is missing, expired or expiring within 30 days. Every identifier the " +
        "project has credentials for or has built is covered, so one built without credentials shows up. No secret is ever read.",
      inputSchema: AUDIT,
    },
    handled((a: ArgsOf<typeof AUDIT>) => auditCredentials(deps, compact(a))),
  );

  server.registerTool(
    "set_submit_key",
    {
      title: "Set submit key",
      description:
        "Set (or clear) the App Store Connect API key EAS uses to submit one iOS bundle id, as eas credentials does. Without one, " +
        "eas submit and a workflow's submit job fail at Prepare credentials. Answers with the key before and the bundle's audit after.",
      inputSchema: SET_KEY,
    },
    handled((a: ArgsOf<typeof SET_KEY>) => setSubmitKey(deps, { bundle_id: a.bundle_id, clear: a.clear, ...compact({ project: a.project, key: a.key }) })),
  );
};
