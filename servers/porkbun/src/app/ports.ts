import type { InputFiles, ToolAnnotations, ToolArgs } from "@foreverworks/mcp-kit";
import type { ZodType } from "zod";

export type { ToolArgs } from "@foreverworks/mcp-kit";

/**
 * One of Porkbun's own tools as this server offers it: the vendor's name,
 * description, input schema and annotations, unchanged. Nothing here restates
 * them; they are read from the pinned package at startup.
 */
export type ToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, ZodType>>;
  readonly annotations: ToolAnnotations;
};

/** Porkbun, as the vendor's package reaches it. */
export type PorkbunPort = {
  /** The pinned `@porkbunllc/mcp-server` version the tools come from. */
  readonly vendorVersion: string;
  /** The tools offered, in the vendor's order. */
  readonly catalog: readonly ToolSpec[];
  /** Runs one of them. A failure is thrown as this server's AppError. */
  readonly run: (name: string, args: ToolArgs) => Promise<unknown>;
  /** The result fields the vendor itself treats as secrets (a webhook's signing `secret`). */
  readonly secretFields: readonly string[];
  /** A copy of a result with those fields replaced by a note. */
  readonly withholdSecrets: (result: unknown) => unknown;
};

export type Deps = {
  readonly porkbun: PorkbunPort;
  /** The kit's input-file reader: a file a tool uploads, read byte-exact by path or from base64 with its sha256. */
  readonly files: InputFiles;
  /** Where files are saved: get_ssl_bundle's certificate and key, get_invoice_pdf's PDF (PORKBUN_OUTBOX_DIR); undefined when nobody set one. */
  readonly outbox: string | undefined;
};
