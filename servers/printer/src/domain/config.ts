import type { AppError } from "./errors.js";

/**
 * Where the device is, from the environment. Pure.
 *
 * PRINTER_URI is the printer's IPP URI, as `ipp://host[:port]/path` (plain
 * HTTP, port 631 by default) or `ipps://host[:port]/path` (TLS; RFC 7472
 * gives 631 as its default too, though many printers serve it on 443), or
 * the same as an http(s) URL. The scanner's eSCL root defaults to `/eSCL` on
 * the same host's web server (443 over TLS when the printer's URI is TLS, else
 * 80), and can be named on its own (PRINTER_ESCL_URL).
 */

export type Endpoints = {
  readonly printer: { readonly printerUri: string; readonly url: URL } | AppError;
  readonly scanner: URL | AppError;
  readonly pin: string | undefined | AppError;
};

const config = (variable: string, message: string): AppError => ({ kind: "config", variable, message });

const SCHEMES: Readonly<Record<string, { readonly http: string; readonly ipp: string; readonly port: string }>> = {
  "ipp:": { http: "http:", ipp: "ipp:", port: "631" },
  "ipps:": { http: "https:", ipp: "ipps:", port: "631" },
  "http:": { http: "http:", ipp: "ipp:", port: "80" },
  "https:": { http: "https:", ipp: "ipps:", port: "443" },
};

const printerFrom = (raw: string | undefined): Endpoints["printer"] => {
  const text = raw?.trim();
  if (!text) return config("PRINTER_URI", "PRINTER_URI is not set: the printer's IPP URI, like ipps://192.0.2.10:443/ipp/print");
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return config("PRINTER_URI", `PRINTER_URI "${text}" is not a URI`);
  }
  const scheme = SCHEMES[parsed.protocol];
  if (scheme === undefined) return config("PRINTER_URI", `PRINTER_URI must be ipp://, ipps://, http:// or https://, not ${parsed.protocol}`);
  const port = parsed.port || scheme.port;
  const path = parsed.pathname === "/" || parsed.pathname === "" ? "/ipp/print" : parsed.pathname;
  const url = new URL(`${scheme.http}//${parsed.hostname}:${port}${path}`);
  // the port stays in the URI even where it is the http one: ipps:// without a port means 631
  return { printerUri: `${scheme.ipp}//${parsed.hostname}:${port}${path}`, url };
};

const scannerFrom = (raw: string | undefined, printer: Endpoints["printer"]): Endpoints["scanner"] => {
  const text = raw?.trim();
  if (text) {
    try {
      const url = new URL(text);
      return url.protocol === "https:" || url.protocol === "http:" ? url : config("PRINTER_ESCL_URL", `PRINTER_ESCL_URL must be http:// or https://, not ${url.protocol}`);
    } catch {
      return config("PRINTER_ESCL_URL", `PRINTER_ESCL_URL "${text}" is not a URL`);
    }
  }
  if ("kind" in printer) return config("PRINTER_URI", "neither PRINTER_ESCL_URL nor PRINTER_URI is set: the scanner's address is derived from the printer's");
  // eSCL lives on the device's web server (443 or 80), whatever port its IPP is on
  return new URL(`${printer.url.protocol}//${printer.url.hostname}/eSCL`);
};

const pinFrom = (raw: string | undefined): Endpoints["pin"] => {
  const text = raw?.trim();
  if (!text) return undefined;
  const hex = text.replace(/[:\s]/g, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : config("PRINTER_TLS_SHA256", "PRINTER_TLS_SHA256 must be a SHA-256 fingerprint: 64 hex digits, colons allowed");
};

export const endpointsFrom = (env: NodeJS.ProcessEnv): Endpoints => {
  const printer = printerFrom(env["PRINTER_URI"]);
  return { printer, scanner: scannerFrom(env["PRINTER_ESCL_URL"], printer), pin: pinFrom(env["PRINTER_TLS_SHA256"]) };
};
