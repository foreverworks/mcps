import { compact } from "@foreverworks/mcp-kit";

import { hex4 } from "../../domain/broadlink/models.js";
import { type Blaster, blasterNamed } from "../../domain/catalog.js";
import { type AppError, asAppError, remedyFor } from "../../domain/errors.js";
import type { Deps } from "../ports.js";

/**
 * What each blaster says about itself. Each answers for itself: one that is
 * unplugged does not hide what another said.
 */

const LOCKED = remedyFor({ kind: "locked", blaster: "", message: "" });

const one = async (deps: Deps, blaster: Blaster) => {
  const where = { name: blaster.name, host: blaster.host };
  try {
    const s = await deps.blasters.status(blaster);
    return compact({
      ...where,
      online: true as const,
      model: s.model ?? `not an RM blaster this server knows (BroadLink type ${hex4(s.devtype)})`,
      devtype: hex4(s.devtype),
      mac: s.mac,
      nameOnDevice: s.nameOnDevice,
      locked: s.locked,
      firmware: s.firmware,
      attention: s.locked ? `nothing can be sent while it is locked: ${LOCKED}` : undefined,
    });
  } catch (thrown) {
    const known = asAppError(thrown);
    if (known === undefined) throw thrown;
    return { ...where, online: known.kind !== "offline" && known.kind !== "config", error: { ...known, remedy: remedyFor(known) } };
  }
};

export const status = async (deps: Deps, which: { readonly blaster?: string | undefined }) => {
  const catalog = await deps.catalog();
  const targets = which.blaster === undefined ? catalog.blasters : [blasterNamed(catalog, which.blaster)];
  return { blasters: await Promise.all(targets.map((b) => one(deps, b))) };
};

/** Failures that mean this integration is broken, not that a blaster lost its power. */
const BROKEN: ReadonlySet<AppError["kind"]> = new Set(["config", "identity", "drift", "device"]);

/**
 * Whether this server works, for a monitor: ok unless the catalog is
 * unusable, a blaster's address answers as another device or not as the
 * protocol says, or a blaster is locked (nothing can be sent until someone
 * unlocks it in the vendor's app). A blaster without power is reported as
 * reachable: false, never a failure: a USB plug gets pulled at home.
 */
export const health = async (deps: Deps) => {
  try {
    const report = await status(deps, {});
    const problems = report.blasters.flatMap((b) => {
      if ("error" in b) return BROKEN.has(b.error.kind) ? [`${b.name}: ${b.error.kind}: ${b.error.message}`] : [];
      return b.locked ? [`${b.name}: locked in the BroadLink app`] : [];
    });
    const devices = (await deps.catalog()).devices.length;
    return compact({
      ok: problems.length === 0,
      problems: problems.length === 0 ? undefined : problems,
      blasters: report.blasters.map((b) => ("error" in b ? { name: b.name, reachable: b.error.kind !== "offline" } : { name: b.name, reachable: true, locked: b.locked })),
      devices,
    });
  } catch (thrown) {
    const known = asAppError(thrown);
    if (known === undefined) throw thrown;
    return { ok: false, problems: [`${known.kind}: ${known.message}`] };
  }
};
