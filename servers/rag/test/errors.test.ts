import { failInputFile } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { describeFailure, fail } from "../src/domain/errors.js";

describe("describeFailure", () => {
  const caught = (throwing: () => never): unknown => {
    try {
      return throwing();
    } catch (thrown) {
      return thrown;
    }
  };

  it("names a failure of this server by its kind and message", () => {
    expect(describeFailure(caught(() => fail({ kind: "database", message: "connection refused", code: "ECONNREFUSED" })))).toBe("database: connection refused");
  });

  it("names a file the kit's reader refused by its code and message, with the system code the message carries", () => {
    const refused = caught(() => failInputFile({ kind: "input", code: "unreadable", message: "/data/notes/pricing.md cannot be opened by this server (EACCES)" }));
    expect(describeFailure(refused)).toBe("unreadable: /data/notes/pricing.md cannot be opened by this server (EACCES)");
    const changed = caught(() => failInputFile({ kind: "checksum_mismatch", message: "the bytes are not the file's", expected_sha256: "a", actual_sha256: "b", size: 3 }));
    expect(describeFailure(changed)).toBe("checksum_mismatch: the bytes are not the file's");
  });

  it("gives an Error's message and anything else as text", () => {
    expect(describeFailure(new Error("EACCES: permission denied, open '/data/notes/pricing.md'"))).toBe("EACCES: permission denied, open '/data/notes/pricing.md'");
    expect(describeFailure("plain")).toBe("plain");
  });
});
