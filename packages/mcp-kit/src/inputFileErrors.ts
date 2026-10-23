import { makeErrorKit } from "./errors.js";

/**
 * Why a file a tool was given was not taken. The vocabulary is the kit's, like
 * the guard's: every server reads its input files through the same
 * helper (inputFile.ts), so every server's envelope recognises these beside
 * its own failures, and an agent reads the same remedy from each.
 */
export type InputFileCode =
  /** Neither or both of path and content_base64. */
  | "source"
  /** A path, to a server that reads none (MCP_FILE_ROOTS unset, over HTTP). */
  | "no_roots"
  | "outside_roots"
  | "symlink"
  | "not_found"
  | "not_a_file"
  | "unreadable"
  | "too_large"
  | "sha256_required"
  | "bad_sha256"
  | "bad_base64";

export type InputFileError =
  | {
      /** The bytes that arrived are not the file the caller hashed. Nothing was stored or sent. */
      readonly kind: "checksum_mismatch";
      readonly message: string;
      /** The sha256 the caller sent: the source file's. */
      readonly expected_sha256: string;
      /** The sha256 of the bytes that arrived. */
      readonly actual_sha256: string;
      /** How many bytes arrived. */
      readonly size: number;
    }
  | { readonly kind: "input"; readonly code: InputFileCode; readonly message: string };

export const { fail: failInputFile, asAppError: asInputFileError } = makeErrorKit<InputFileError>("mcp-kit.inputFile");

const BY_PATH = "copy the file itself (cp, not a link) into this server's file folder (the tool's description names it) and pass its path";

export const inputFileRemedy = (error: InputFileError): string => {
  if (error.kind === "checksum_mismatch") {
    return `the content was altered on the way, which is what typing or copying base64 by hand does: ${BY_PATH}, or let a script encode the file; nothing was stored or sent`;
  }
  switch (error.code) {
    case "source":
      return "give the file one way: path, or content_base64 with its sha256";
    case "no_roots":
      return "this server reads no paths here: send content_base64 with its sha256, both produced by a script from the file";
    case "outside_roots":
    case "symlink":
    case "not_found":
    case "not_a_file":
      return BY_PATH;
    case "unreadable":
      return "make it readable by this server (chmod 644 the file: cp keeps the source's mode)";
    case "too_large":
      return "this server does not take a file that large";
    case "sha256_required":
    case "bad_sha256":
      return "send sha256 as the 64 hex characters sha256sum prints for the SOURCE file, from the script that encoded it; better, pass the file by path";
    case "bad_base64":
      return "content_base64 must be standard base64 (A-Z a-z 0-9 + /, = padding) as `base64 -w0` prints it; better, pass the file by path";
  }
};
