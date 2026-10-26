import { compact } from "@foreverworks/mcp-kit";

import { codeText } from "../../domain/catalog.js";
import type { Deps } from "../ports.js";

/** Said wherever a device's state could be asked about: nothing here can read it. */
export const ONE_WAY =
  "IR goes one way: nothing here can read whether a device is on or off or how it is set, so ask someone who can see it; " +
  "a toggle button flips the device, so pressing it again undoes the press.";

export const devices = async (deps: Deps) => {
  const catalog = await deps.catalog();
  return {
    devices: catalog.devices.map((d) =>
      compact({
        name: d.name,
        title: d.title,
        blaster: d.blaster,
        note: d.note,
        buttons: d.buttons.map((b) =>
          compact({
            name: b.name,
            code: codeText(b.code),
            toggle: b.toggle ? true : undefined,
            confirm: b.confirm ? ("the user approves each press: press_confirmed" as const) : undefined,
            note: b.note,
          }),
        ),
      }),
    ),
    blasters: catalog.blasters.map((b) => b.name),
    note: ONE_WAY,
  };
};
