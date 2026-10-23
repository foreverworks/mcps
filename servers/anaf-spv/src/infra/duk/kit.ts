import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { HttpRequest } from "@foreverworks/mcp-kit";

import type { FormName, KitSource } from "../../domain/declarations.js";
import { drift, fail } from "../../domain/errors.js";
import { sha256 } from "../files.js";
import { unzip } from "./zip.js";

/**
 * A DUKIntegrator kit for one form and one of ANAF's packages for it, built once in the
 * cache and kept: ANAF's common jars and the integrator as its update server
 * lists them now (`update5/versiuni.xml`), the config folder it refuses to
 * start without ("folderul config nu poate fi determinat", measured), and the
 * package's own validator and PDF jars from the forms page's "soft J" zip
 * (domain/declarations/kits.ts says which zip serves which periods).
 * The kit's Windows JRE and smart-card configs are not needed and not taken.
 * Every file's source and SHA-256 is in the kit's kit.json.
 */
export const STATIC_ANAF = "https://static.anaf.ro/static/10/Anaf";
const VERSIONS = `${STATIC_ANAF}/update5/versiuni.xml`;
const CONFIG = `${STATIC_ANAF}/update5/cc2/config.properties`;
const SOFT_J = `${STATIC_ANAF}/Declaratii_R/AplicatiiDec`;

export type KitFile = { readonly file: string; readonly source: string; readonly sha256: string };
export type Kit = { readonly dir: string; readonly form: FormName; readonly zip: string; readonly builtAt: string; readonly files: readonly KitFile[] };

/** versiuni.xml's integrator section: the jars every declaration's validator runs with. The URLs it lists are http; static.anaf.ro serves the same paths over https. */
const commonJars = (xml: string): readonly string[] => {
  const integrator = /<integrator>([\s\S]*?)<\/integrator>/.exec(xml)?.[1] ?? fail(drift("ANAF's versiuni.xml has no <integrator>"));
  const urls = ["iJars", "sJars", "zJars"].flatMap((group) => [...(new RegExp(`<${group}>([\\s\\S]*?)</${group}>`).exec(integrator)?.[1] ?? "").matchAll(/<jarURL>\s*([^<\s]+)\s*<\/jarURL>/g)].map((m) => m[1] ?? ""));
  const jars = urls.filter((u) => u.endsWith(".jar")).map((u) => u.replace(/^http:\/\//, "https://"));
  if (!jars.some((u) => u.endsWith("/DUKIntegrator.jar"))) fail(drift("ANAF's versiuni.xml lists no DUKIntegrator.jar"));
  return jars;
};

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

export const makeKits = (root: string, http: HttpRequest, now: () => number) => {
  const building = new Map<string, Promise<Kit>>();

  const build = async (form: FormName, zipName: string, dir: string): Promise<Kit> => {
    const temp = `${dir}.build-${randomBytes(4).toString("hex")}`;
    await mkdir(join(temp, "lib"), { recursive: true });
    await mkdir(join(temp, "config"), { recursive: true });
    try {
      const files: KitFile[] = [];
      const put = async (file: string, source: string, bytes: Uint8Array) => {
        await writeFile(join(temp, file), bytes, { mode: 0o640 });
        files.push({ file, source, sha256: sha256(bytes) });
      };
      const get = (url: string) => http<Uint8Array>(url, { as: "bytes" });
      const versions = new TextDecoder().decode(await get(VERSIONS));
      for (const url of commonJars(versions)) {
        const name = url.slice(url.lastIndexOf("/") + 1);
        await put(name === "DUKIntegrator.jar" ? name : join("lib", name), url, await get(url));
      }
      await put(join("config", "config.properties"), CONFIG, await get(CONFIG));
      const zipUrl = `${SOFT_J}/${zipName}`;
      const archive = unzip(await get(zipUrl), zipName);
      for (const jar of [`${form}Validator.jar`, `${form}Pdf.jar`]) {
        const entry = [...archive].find(([path]) => path === jar || path.endsWith(`/${jar}`)) ?? fail(drift(`${zipName} holds no ${jar}`));
        await put(join("lib", jar), `${zipUrl}!${entry[0]}`, entry[1]);
      }
      const kit: Kit = { dir, form, zip: zipName, builtAt: new Date(now()).toISOString(), files };
      await writeFile(join(temp, "kit.json"), `${JSON.stringify({ ...kit, dir: undefined }, null, 2)}\n`, { mode: 0o640 });
      await rm(dir, { recursive: true, force: true });
      await rename(temp, dir);
      return kit;
    } catch (thrown) {
      await rm(temp, { recursive: true, force: true });
      throw thrown;
    }
  };

  /** The kit for `form` from ANAF's package `source`, built on first use. Two calls together build it once. */
  const kit = async (form: FormName, source: KitSource): Promise<Kit> => {
    const key = `${form}-${source.zip.replace(/\.zip$/i, "")}`;
    const dir = join(root, key);
    if (await exists(join(dir, "kit.json"))) {
      const stored = JSON.parse(await readFile(join(dir, "kit.json"), "utf8")) as Omit<Kit, "dir">;
      return { ...stored, dir };
    }
    const pending = building.get(key) ?? build(form, source.zip, dir).finally(() => building.delete(key));
    building.set(key, pending);
    return pending;
  };

  return { kit };
};
