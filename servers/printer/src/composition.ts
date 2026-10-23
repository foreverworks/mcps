import { join } from "node:path";

import { egressFrom, envPath, inputFilesFrom, type InputFiles, stateDirOf } from "@foreverworks/mcp-kit";

import type { Deps, Render } from "./app/ports.js";
import { endpointsFrom } from "./domain/config.js";
import { type DeviceFetch, makeDeviceHttp } from "./infra/device.js";
import { makeEsclScanner } from "./infra/escl.js";
import { makeCalibrationStore, makeOutbox, makeScratch } from "./infra/files.js";
import { makeIppPrinter } from "./infra/ipp.js";
import { makeRender } from "./infra/render.js";

export type BuildOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: DeviceFetch;
  readonly render?: Render;
  readonly inputFiles?: InputFiles;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
};

/**
 * The composition root: the only module naming both a port and what
 * implements it. Nothing here touches the device: a tool reaches it when it
 * is called, so the server starts and lists its tools with no printer
 * configured, and those tools answer with the variable that is missing.
 */
export const buildDeps = (options: BuildOptions = {}): Deps => {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const endpoints = endpointsFrom(env);
  const pin = endpoints.pin;
  const pinError = typeof pin === "object" ? pin : undefined;
  const http = (device: "printer" | "scanner") =>
    makeDeviceHttp({ pin: typeof pin === "string" ? pin : undefined, device, egress: egressFrom(env), ...(options.fetch === undefined ? {} : { fetch: options.fetch }) });
  const stateDir = stateDirOf(env, "printer", "PRINTER_STATE_DIR");
  return {
    printer: makeIppPrinter(pinError ?? endpoints.printer, http("printer")),
    scanner: makeEsclScanner(pinError ?? endpoints.scanner, http("scanner"), sleep, now),
    render: options.render ?? makeRender(),
    calibration: makeCalibrationStore(stateDir),
    outbox: makeOutbox(envPath(env, "PRINTER_OUTBOX_DIR") ?? join(stateDir, "outbox")),
    inputFiles: options.inputFiles ?? inputFilesFrom(env),
    scratch: makeScratch(),
    now,
    sleep,
  };
};
