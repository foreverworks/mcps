import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DukPort } from "../../app/ports.js";
import { dukVerdict } from "../../domain/declarations.js";
import { configError, fail } from "../../domain/errors.js";
import type { makeKits } from "./kit.js";

/**
 * DUKIntegrator, run as its documentation says, from its own folder (it finds
 * lib/ and config/ relative to where it starts):
 *
 *   java -jar DUKIntegrator.jar -v <FORM> <xml> <errors>
 *   java -jar DUKIntegrator.jar -p <FORM> <xml> <errors> $ <attachment> <pdf>
 *
 * The JVM is held small (one compiler thread, serial GC) because it runs
 * inside the server's own memory and task limits; a validation measured about
 * two seconds. The error file is the integrator's own words, kept verbatim.
 *
 * The PDF step's fifth argument is a ZIP to attach; ANAF's Instructiuni.txt
 * (update5/documentatie_6): "la declaratiile fara ZIP atasat acest parametru
 * trebuie sa fie 0". None of D212, D100, D300 and D112 attaches one, and `0`
 * is what each takes (measured on each of the four).
 */
const NO_ZIP = "0";
const JVM = ["-Xmx256m", "-Xss1m", "-XX:-MaxFDLimit", "-XX:-UsePerfData", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-XX:CICompilerCount=1", "-XX:ActiveProcessorCount=1", "-Djava.awt.headless=true"];

const run = (java: string, cwd: string, args: readonly string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(java, [...JVM, "-jar", "DUKIntegrator.jar", ...args], { cwd, timeout: 180_000, maxBuffer: 4 << 20, env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", LANG: "C.UTF-8" } }, (error, stdout, stderr) => {
      if (error !== null && (error as NodeJS.ErrnoException).code === "ENOENT") return reject(error);
      if (error !== null && error.killed) return reject(new Error(`DUKIntegrator ran past 180 s and was stopped`));
      resolve(`${stdout}${stderr}`);
    });
  });

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const CP1250 = new TextDecoder("windows-1250");

/** The integrator's own text: UTF-8 when it is, else the Windows code page its Romanian messages use. */
const textOf = (bytes: Uint8Array): string => {
  try {
    return UTF8.decode(bytes);
  } catch {
    return CP1250.decode(bytes);
  }
};

export const makeDuk = (options: { readonly java: string; readonly workRoot: string; readonly kits: ReturnType<typeof makeKits> }): DukPort => ({
  run: async ({ form, kit: source, xml, pdf }) => {
    const kit = await options.kits.kit(form, source);
    const work = join(options.workRoot, randomBytes(6).toString("hex"));
    await mkdir(work, { recursive: true, mode: 0o700 });
    try {
      // The XML keeps the form's own name: the PDF step embeds the file under it.
      const xmlPath = join(work, `${form}.xml`);
      await writeFile(xmlPath, xml, { mode: 0o600 });
      const java = async (args: readonly string[]) =>
        run(options.java, kit.dir, args).catch((thrown: unknown) =>
          (thrown as NodeJS.ErrnoException).code === "ENOENT" ? fail(configError(`no Java runtime at "${options.java}" (ANAF_SPV_JAVA); DUKIntegrator needs one, 8 or newer`)) : Promise.reject(thrown),
        );
      const errorsV = join(work, "erori-v.txt");
      const output = await java(["-v", form, xmlPath, errorsV]);
      const errors = textOf(await readFile(errorsV).catch(() => new Uint8Array()));
      const verdict = dukVerdict(output, errors);
      if (!verdict.valid || !pdf) return { valid: verdict.valid, output: output.trim(), errors: errors.trim(), kit };
      const pdfPath = join(work, `${form}.pdf`);
      const errorsP = join(work, "erori-p.txt");
      const made = await java(["-p", form, xmlPath, errorsP, "$", NO_ZIP, pdfPath]);
      const bytes = await readFile(pdfPath).catch(() => undefined);
      return {
        valid: true,
        output: `${output.trim()}\n${made.trim()}`,
        errors: errors.trim(),
        kit,
        ...(bytes === undefined ? { pdfFailure: `${made.trim()} ${textOf(await readFile(errorsP).catch(() => new Uint8Array())).trim()}`.trim() } : { pdf: new Uint8Array(bytes) }),
      };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  },
});
