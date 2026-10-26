import { envPath, readConfigFile } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { type Catalog, catalogProblems, type Code } from "../domain/catalog.js";
import { fail } from "../domain/errors.js";

/**
 * The catalog file (SMART_HOME_CONFIG_FILE), checked and turned into the
 * domain's Catalog. A byte may be written as a number or as "0x46", the way
 * IR code tables print it.
 */

export const CONFIG_VARIABLE = "SMART_HOME_CONFIG_FILE";

const byteOrHex = (max: number) =>
  z
    .union([z.number().int(), z.string().regex(/^0x[0-9a-fA-F]{1,4}$/, 'a number, or hex like "0x46"').transform((s) => parseInt(s.slice(2), 16))])
    .pipe(z.number().int().min(0).max(max));

const name = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/, "lowercase letters, digits, - and _, at most 48");

const button = z
  .strictObject({
    name,
    command: byteOrHex(0xff).optional(),
    address: byteOrHex(0xffff).optional(),
    pulses: z.array(z.number().int().min(1).max(2_000_000)).min(4).max(1024).optional(),
    toggle: z.boolean().default(false),
    confirm: z.boolean().default(false),
    note: z.string().max(300).optional(),
  })
  .refine((b) => (b.command === undefined) !== (b.pulses === undefined), "a button has either command (NEC) or pulses (raw), not both");

const device = z.strictObject({
  name,
  title: z.string().max(80).optional(),
  blaster: name.optional(),
  address: byteOrHex(0xffff).optional(),
  note: z.string().max(500).optional(),
  buttons: z.array(button).max(200),
});

const blaster = z.strictObject({
  name,
  host: z.string().min(1).max(253),
  mac: z
    .string()
    .regex(/^[0-9a-fA-F]{2}([:-][0-9a-fA-F]{2}){5}$/, "six bytes like aa:bb:cc:dd:ee:ff")
    .transform((m) => m.toLowerCase().replace(/-/g, ":"))
    .optional(),
});

const file = z.strictObject({ blasters: z.array(blaster).min(1).max(20), devices: z.array(device).max(100).default([]) });

type File = z.infer<typeof file>;

const codeOf = (d: File["devices"][number], b: File["devices"][number]["buttons"][number]): Code | string => {
  if (b.pulses !== undefined) return { kind: "raw", pulses: b.pulses };
  const address = b.address ?? d.address;
  return address === undefined ? `device "${d.name}" button "${b.name}" has a command but neither it nor its device has an NEC address` : { kind: "nec", address, command: b.command ?? 0 };
};

const configFail = (message: string): never => fail({ kind: "config", variable: CONFIG_VARIABLE, message });

/** The catalog as the domain holds it, or a config failure naming every problem. Pure. */
export const catalogFrom = (parsed: File): Catalog => {
  const [only, ...others] = parsed.blasters;
  const problems: string[] = [];
  const devices = parsed.devices.map((d) => {
    const blasterName = d.blaster ?? (only !== undefined && others.length === 0 ? only.name : undefined);
    if (blasterName === undefined) problems.push(`device "${d.name}" must name its blaster: the catalog has several`);
    return {
      name: d.name,
      title: d.title,
      blaster: blasterName ?? "",
      note: d.note,
      buttons: d.buttons.flatMap((b) => {
        const code = codeOf(d, b);
        if (typeof code === "string") {
          problems.push(code);
          return [];
        }
        return [{ name: b.name, code, toggle: b.toggle, confirm: b.confirm, note: b.note }];
      }),
    };
  });
  const catalog: Catalog = { blasters: parsed.blasters.map((b) => ({ name: b.name, host: b.host, mac: b.mac })), devices };
  const all = [...problems, ...catalogProblems(catalog)];
  return all.length === 0 ? catalog : configFail(`the catalog at ${CONFIG_VARIABLE} is not usable: ${all.join("; ")}`);
};

/** Read on every call, so an edited file takes effect on the next one. */
export const makeCatalogSource =
  (env: NodeJS.ProcessEnv) =>
  async (): Promise<Catalog> => {
    const path = envPath(env, CONFIG_VARIABLE) ?? configFail(`${CONFIG_VARIABLE} is not set: the JSON file naming the blasters, devices and buttons (README, Configuration)`);
    return catalogFrom(await readConfigFile(path, file, configFail));
  };
