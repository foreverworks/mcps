import { compact } from "@foreverworks/mcp-kit";

import { codeText } from "../../domain/catalog.js";
import type { Deps } from "../ports.js";

/** Said wherever a device's state could be asked about: nothing here can read it. */
export const ONE_WAY =
  "IR goes one way: nothing here can read whether a device is on or off or how it is set, so ask someone who can see it; " +
  "a toggle button flips the device, so pressing it again undoes the press.";

/** Said of a button marked wake, in devices and after a press. */
export const WAKE =
  "the device's first press only wakes it (its display lights): press sends one press first to wake it, then the presses asked for; " +
  "if it was already awake, that first press acts too, so pass wake: false when it was pressed a moment ago";

export const devices = async (deps: Deps) => {
  const catalog = await deps.catalog();
  return {
    devices: catalog.devices.map((d) =>
      compact({
        name: d.name,
        title: d.title,
        blaster: d.blaster,
        note: d.note,
        intervalMs: d.intervalMs,
        buttons: d.buttons.map((b) =>
          compact({
            name: b.name,
            code: codeText(b.code),
            toggle: b.toggle ? true : undefined,
            confirm: b.confirm ? ("the user approves each press: press_confirmed" as const) : undefined,
            wake: b.wake ? WAKE : undefined,
            note: b.note,
          }),
        ),
      }),
    ),
    blasters: catalog.blasters.map((b) => b.name),
    note: ONE_WAY,
  };
};
