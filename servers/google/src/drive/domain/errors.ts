import { type AppError, describeThrownWith, QUOTA_REMEDY, reconsent } from "../../domain/errors.js";

/**
 * Drive's half of the failure vocabulary: the remedies. The failures
 * themselves are Google's and live in the shared module, re-exported here so
 * nothing under drive/ has to know which half it is importing. `ambiguous`,
 * `not_found` and `quota` joined that module with this product.
 */
export * from "../../domain/errors.js";

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return `Drive runs on its own grant (DRIVE_CREDENTIALS) once it has one, else on an rclone remote's (DRIVE_RCLONE_CONF); fix what the message names, or ${reconsent("drive")}`;
    case "auth":
      return `the Drive grant was refused; ${reconsent("drive")}`;
    case "input":
      return "fix the arguments and call again";
    case "not_found":
      return "check the path or id with resolve_path or find_files; a trashed file is still found by id but not by path";
    case "ambiguous":
      return "two or more objects answer to that path; call again with file_id, which resolve_path returns for each candidate";
    case "quota":
      return QUOTA_REMEDY;
    case "api":
      if (error.status === 401 || error.status === 403) return "this account cannot act on that file; check who owns it and whether the grant covers write";
      return error.status === 0 ? "Drive was unreachable; retry later" : "retry; if it persists, read the body field";
  }
};

/** One failure as a sentence with its remedy, for the paths that report it and carry on. */
export const describeThrown = describeThrownWith(remedyFor);
