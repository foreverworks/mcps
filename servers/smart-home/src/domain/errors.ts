import { makeErrorKit } from "@foreverworks/mcp-kit";

/** The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts). */
export type AppError =
  /** The arguments cannot be done as asked; nothing was sent. */
  | { readonly kind: "input"; readonly message: string }
  /** A setting this needs is missing or wrong; `variable` names it. */
  | { readonly kind: "config"; readonly variable: string; readonly message: string }
  /** The blaster did not answer its hello: no power, off the network, or no route to it. */
  | { readonly kind: "offline"; readonly blaster: string; readonly message: string }
  /** The blaster answers but refuses a session: it is locked in its vendor's app. */
  | { readonly kind: "locked"; readonly blaster: string; readonly message: string }
  /** Another device answers at the blaster's address (its MAC is not the configured one). */
  | { readonly kind: "identity"; readonly blaster: string; readonly expected: string; readonly found: string; readonly message: string }
  /** The blaster answered a command with an error code. */
  | { readonly kind: "device"; readonly blaster: string; readonly code: number; readonly message: string }
  /** A code went out and no answer came back: it may or may not have been sent. */
  | { readonly kind: "outcome_unknown"; readonly blaster: string; readonly message: string }
  /** Learning ended without a code: nobody pressed, or the remote did not reach the blaster. */
  | { readonly kind: "nothing_learned"; readonly blaster: string; readonly message: string }
  /** The button is marked for a person to approve, and the tool called does not ask. */
  | { readonly kind: "needs_confirmation"; readonly device: string; readonly button: string; readonly message: string }
  /** The blaster answered with something this server does not understand. */
  | { readonly kind: "drift"; readonly message: string };

export const inputError = (message: string): AppError => ({ kind: "input", message });
export const drift = (message: string): AppError => ({ kind: "drift", message });

export const { fail, asAppError } = makeErrorKit<AppError>("smart-home");

/** What to do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "input":
      return "fix what the message names and call again; devices lists every device and button";
    case "config":
      return `set ${error.variable} in this server's environment (see its README); the next call reads it again`;
    case "offline":
      return "check that the blaster has power (a loose USB plug is the usual cause) and is on the network; it rejoins by itself within a minute of getting power, then call status";
    case "locked":
      return "turn off Lock device in the blaster's settings in the BroadLink app (adding the device there turns it on), then call status";
    case "identity":
      return "another device answers at the blaster's address: check the router's address reservation for the blaster's MAC, or correct its mac in the config";
    case "device":
      return "call status; if the blaster keeps refusing, take its power away for ten seconds and try again";
    case "outcome_unknown":
      return "the code may or may not have gone out: check the device (or ask someone who can see it) before pressing again, because a second press of a toggle undoes the first";
    case "nothing_learned":
      return "point the remote at the blaster from a hand's width away, call learn, then press the button once while it listens";
    case "needs_confirmation":
      return "call press_confirmed instead, which asks the user before the code goes out";
    case "drift":
      return "the blaster answered unlike the BroadLink protocol; note its model and firmware (status) and report it";
  }
};
