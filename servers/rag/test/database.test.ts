import { describe, expect, it } from "vitest";

import { poolConfigOf } from "../src/infra/database.js";

describe("poolConfigOf", () => {
  it("takes the password from the file or variable when the URL has none", () => {
    const config = poolConfigOf("postgresql://rag@127.0.0.1:5433/rag", "s3cret");
    expect(config).toMatchObject({ user: "rag", host: "127.0.0.1", port: 5433, database: "rag", password: "s3cret" });
  });

  it("keeps a password the URL carries when no other is given, and prefers the given one", () => {
    expect(poolConfigOf("postgresql://rag:inline@db/rag", undefined).password).toBe("inline");
    expect(poolConfigOf("postgresql://rag:inline@db/rag", "file").password).toBe("file");
  });
});
