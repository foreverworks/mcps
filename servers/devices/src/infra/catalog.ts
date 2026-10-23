import { readFile } from "node:fs/promises";

import { z } from "zod";

import { catalogProblems, DEFAULT_TENANT, emptyCatalog, type Catalog, type Probe } from "../domain/catalog.js";
import { asAppError, configError, fail } from "../domain/errors.js";

/**
 * The catalog file (DEVICES_CATALOG_FILE), JSON in the format the README documents. A machine that
 * runs a broker with no devices can be given a file with no hosts and a `note` saying where devices
 * are brokered instead, so every answer there says so instead of failing.
 */
const platform = z.enum(["ios", "android", "macos", "windows"]);

const commands = z.array(z.string().trim().min(1).max(60)).max(10).default([]);

const schema = z.object({
  box: z.string().min(1).optional(),
  note: z.string().optional(),
  session_hint: z.string().trim().min(1).max(300).optional(),
  wrappers: z.object({ ios: commands, android: commands, macos: commands, windows: commands }).default({ ios: [], android: [], macos: [], windows: [] }),
  profiles: z.record(z.string(), z.string()).default({}),
  // The profile a request that names none gets, per platform; a device on another profile is then leased only by name.
  default_profiles: z.partialRecord(platform, z.string().min(1)).default({}),
  // Profile -> its form ("watch"): a session holds one device per platform and form.
  forms: z.record(z.string(), z.string().regex(/^[a-z]{1,20}$/)).default({}),
  hosts: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        platform,
        ssh: z.string().min(1),
        requires_ac: z.boolean().default(false),
        spawn_max: z.number().int().min(0).default(0),
        cost_mib: z.number().int().min(0).default(0),
        reserve_mib: z.number().int().min(0).default(0),
        builders: z.number().int().min(0).default(0),
        control: z.string().min(1).optional(),
        isolates: z.boolean().default(false),
      }),
    )
    .default([]),
  devices: z
    .array(
      z.object({
        id: z.string().min(1),
        platform,
        host: z.string().min(1),
        profile: z.string().min(1),
        mode: z.enum(["fixed", "spawn", "reserved"]),
        maestro: z.boolean().default(false),
        adb: z.object({ port: z.number().int().min(1).max(65535), serial: z.string().min(1) }).optional(),
        // {"door": <port>}: the slot's adbd on the broker's loopback; "unit": its state from the host's control command.
        probe: z.union([z.object({ door: z.number().int().min(1).max(65535) }), z.literal("unit")]).optional(),
        tenant: z.string().min(1).default(DEFAULT_TENANT),
        instance: z.string().min(1).optional(),
        // Other system images on the same emulator slot: another instance each, on its serial, adb port and probe.
        variants: z.array(z.object({ profile: z.string().min(1), instance: z.string().min(1) })).optional(),
        // A watch to create and pair with the simulator: `{ name, type }`, as the simulator's own.
        simulator: z.object({ name: z.string().min(1), type: z.string().min(1), watch: z.object({ name: z.string().min(1), type: z.string().min(1) }).optional() }).optional(),
        // A desktop's address for its holder: an ssh destination, its port, a host to jump through.
        ssh: z.object({ target: z.string().min(1), port: z.number().int().min(1).max(65535).optional(), jump: z.string().min(1).optional() }).optional(),
        // A spawn slot's own memory cost when it differs from its host's (a VM beside emulators).
        cost_mib: z.number().int().min(0).optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
});

const probeOf = (p: { readonly door: number } | "unit"): Probe => (p === "unit" ? { kind: "unit" } : { kind: "door", port: p.door });

/**
 * What startup found: a catalog, with a note when it is empty on purpose, or the reason none could be
 * read. A broker whose catalog is broken still starts, and every tool answers that reason as a config error.
 */
export type LoadedCatalog = { readonly catalog: Catalog; readonly note?: string; readonly problem?: string };

/** `box` names the machine when the catalog does not. Throws a tagged config failure. */
export const parseCatalog = (text: string, box: string): LoadedCatalog => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return fail(configError(`the catalog is not JSON: ${String(e)}`));
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return fail(configError(`the catalog does not validate: ${parsed.error.message.slice(0, 400)}`));
  const c = parsed.data;
  const catalog: Catalog = {
    box: c.box ?? box,
    profiles: c.profiles,
    defaultProfiles: c.default_profiles,
    forms: c.forms,
    clients: { ...(c.session_hint === undefined ? {} : { sessionHint: c.session_hint }), wrappers: c.wrappers },
    hosts: c.hosts.map((h) => ({
      id: h.id,
      label: h.label,
      platform: h.platform,
      ssh: h.ssh,
      requiresAc: h.requires_ac,
      spawnMax: h.spawn_max,
      costMiB: h.cost_mib,
      reserveMiB: h.reserve_mib,
      builders: h.builders,
      ...(h.control === undefined ? {} : { control: h.control }),
      isolates: h.isolates,
    })),
    devices: c.devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      host: d.host,
      profile: d.profile,
      mode: d.mode,
      maestro: d.maestro,
      ...(d.adb === undefined ? {} : { adb: { port: d.adb.port, serial: d.adb.serial } }),
      ...(d.probe === undefined ? {} : { probe: probeOf(d.probe) }),
      tenant: d.tenant,
      ...(d.instance === undefined ? {} : { instance: d.instance }),
      ...(d.variants === undefined ? {} : { variants: d.variants.map((v) => ({ profile: v.profile, instance: v.instance })) }),
      ...(d.simulator === undefined
        ? {}
        : { simulator: { name: d.simulator.name, type: d.simulator.type, ...(d.simulator.watch === undefined ? {} : { watch: { name: d.simulator.watch.name, type: d.simulator.watch.type } }) } }),
      ...(d.ssh === undefined
        ? {}
        : { ssh: { target: d.ssh.target, ...(d.ssh.port === undefined ? {} : { port: d.ssh.port }), ...(d.ssh.jump === undefined ? {} : { jump: d.ssh.jump }) } }),
      ...(d.cost_mib === undefined ? {} : { costMiB: d.cost_mib }),
      ...(d.note === undefined ? {} : { note: d.note }),
    })),
  };
  const problems = catalogProblems(catalog);
  if (problems.length > 0) return fail(configError(`the catalog is inconsistent: ${problems.join("; ")}`));
  return { catalog, ...(c.note === undefined ? {} : { note: c.note }) };
};

export const loadCatalog = async (path: string | undefined, box: string): Promise<LoadedCatalog> => {
  if (path === undefined) return { catalog: emptyCatalog(box), note: `nothing is configured on ${box}: DEVICES_CATALOG_FILE is unset, so this broker has no devices` };
  try {
    return parseCatalog(await readFile(path, "utf8"), box);
  } catch (thrown) {
    const known = asAppError(thrown);
    const problem = known?.message ?? `the catalog ${path} cannot be read: ${(thrown as Error).message ?? String(thrown)}`;
    return { catalog: emptyCatalog(box), problem };
  }
};
