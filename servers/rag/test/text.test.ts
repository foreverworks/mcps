import { describe, expect, it } from "vitest";

import { includesRomanian, normaliseText, visibleLength } from "../src/domain/text.js";

describe("normaliseText", () => {
  it("rewrites the cedilla ş and ţ as Romanian's comma-below letters, only for Romanian", () => {
    expect(normaliseText("Ţara şi preţul", "ron")).toBe("Țara și prețul");
    expect(normaliseText("Ţara şi preţul", "ron+eng")).toBe("Țara și prețul");
    expect(normaliseText("Kuşadası", "tur")).toBe("Kuşadası");
    expect(includesRomanian("eng+ron")).toBe(true);
    expect(includesRomanian("eng")).toBe(false);
  });

  it("unifies line endings, spaces and blank lines, and drops invisible characters", () => {
    expect(normaliseText("a\r\nb  \t c \n\n\n\nd­ e﻿", "eng")).toBe("a\nb c\n\nd e");
    expect(normaliseText("é", "eng")).toBe("é");
  });

  it("drops control characters Postgres would refuse, and turns a form feed into a line break", () => {
    expect(normaliseText("a\u0000b\u0007c\fd\te", "eng")).toBe("abc\nd\te");
  });

  it("counts visible characters only", () => {
    expect(visibleLength(" \n a b \f")).toBe(2);
  });
});
