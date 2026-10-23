/**
 * A model of a Google Doc's index space, enough to apply the batchUpdate
 * requests this server sends and render the result as the JSON documents.get
 * returns. It exists so the index arithmetic in toRequests.ts is proven by
 * running it, not by reading it.
 *
 * Modelled on the Docs API reference (developers.google.com/docs/api, 2026-09):
 * - index 0 is the body's section break; every paragraph ends in "\n", which
 *   carries the paragraph's style and bullet;
 * - a table is one index to open it, one per row, one per cell, the cells'
 *   paragraphs, and one to close it; insertTable puts a "\n" before it;
 * - inserted text copies the paragraph style (bullets included) of the
 *   paragraph at the insertion index and the text style of the text before it;
 * - createParagraphBullets removes each paragraph's leading tabs and nests it
 *   one level per tab;
 * - the body's last newline cannot be deleted, a table cannot be partly
 *   deleted, and nor can the newline before a table that stays.
 * The simulator throws wherever Docs would answer 400.
 */
import type { docs_v1 } from "@googleapis/docs";

type TextStyle = Readonly<Record<string, unknown>>;
type Bullet = { readonly listId: string; readonly depth: number };
type Para = { readonly named: string; readonly headingId?: string; readonly bullet?: Bullet };
type Unit =
  | { readonly kind: "char"; readonly ch: string; readonly style: TextStyle; readonly para?: Para }
  | { readonly kind: "tableStart" | "rowStart" | "cellStart" | "tableEnd" | "sectionBreak" };

type Request = docs_v1.Schema$Request;

export type Spec = { readonly text: string; readonly named?: string; readonly bullet?: { readonly ordered: boolean; readonly depth: number } };

export const makeSimulator = (paragraphs: readonly Spec[]) => {
  let units: Unit[] = [{ kind: "sectionBreak" }];
  const lists = new Map<string, boolean>();
  let nextId = 0;
  const newId = (prefix: string): string => `${prefix}.${++nextId}`;

  for (const p of paragraphs.length ? paragraphs : [{ text: "" }]) {
    const bullet = p.bullet ? { listId: newId("kix"), depth: p.bullet.depth } : undefined;
    if (bullet && p.bullet) lists.set(bullet.listId, p.bullet.ordered);
    const named = p.named ?? "NORMAL_TEXT";
    const para: Para = { named, ...(named.startsWith("HEADING") ? { headingId: newId("h") } : {}), ...(bullet ? { bullet } : {}) };
    units.push(...[...p.text].map((ch): Unit => ({ kind: "char", ch, style: {} })), { kind: "char", ch: "\n", style: {}, para });
  }

  const isChar = (u: Unit | undefined): u is Extract<Unit, { kind: "char" }> => u?.kind === "char";
  const fail = (message: string): never => {
    throw new Error(`Docs would refuse: ${message}`);
  };

  /** The paragraph [start, end) around index: chars back to the previous "\n" or marker, forward to its "\n". */
  const paragraphAt = (index: number): { start: number; end: number } => {
    let end = index;
    while (isChar(units[end]) && (units[end] as { ch: string }).ch !== "\n") end += 1;
    if (!isChar(units[end])) fail(`index ${index} is not inside a paragraph`);
    let start = index;
    while (start > 0 && isChar(units[start - 1]) && (units[start - 1] as { ch: string }).ch !== "\n") start -= 1;
    return { start, end: end + 1 };
  };

  const paragraphsIn = (s: number, e: number): { start: number; end: number }[] => {
    const found: { start: number; end: number }[] = [];
    for (let i = s; i < e; i += 1) {
      if (!isChar(units[i])) continue;
      const p = paragraphAt(i);
      if (!found.some((f) => f.start === p.start)) found.push(p);
      i = p.end - 1;
    }
    return found;
  };

  const paraOf = (p: { end: number }): Para => (units[p.end - 1] as { para: Para }).para;
  const setPara = (p: { end: number }, para: Para): void => {
    const u = units[p.end - 1] as Extract<Unit, { kind: "char" }>;
    units[p.end - 1] = { ...u, para };
  };

  const checkRange = (r: docs_v1.Schema$Range | undefined): [number, number] => {
    const s = r?.startIndex ?? fail("range without startIndex");
    const e = r?.endIndex ?? fail("range without endIndex");
    if (s < 1 || e > units.length || e <= s) fail(`range [${s}, ${e}) outside the body (length ${units.length})`);
    return [s, e];
  };

  const insert = (index: number, text: string): void => {
    if (index < 1 || index >= units.length) fail(`insert index ${index} outside the body`);
    if (!isChar(units[index])) fail(`cannot insert at ${index}: not inside a paragraph`);
    if (/[\u0000-\u0008\u000c-\u001f]/.test(text)) fail("text holds characters Docs strips");
    const para = paraOf(paragraphAt(index));
    const before = units[index - 1];
    const style = isChar(before) && before.ch !== "\n" ? before.style : (units[index] as { style: TextStyle }).style;
    const { headingId: _, ...copied } = para;
    units.splice(index, 0, ...[...text].map((ch): Unit => ({ kind: "char", ch, style, ...(ch === "\n" ? { para: copied } : {}) })));
  };

  const apply = (request: Request): void => {
    if (request.insertText) {
      insert(request.insertText.location?.index ?? fail("insertText without index"), request.insertText.text ?? "");
    } else if (request.insertTable) {
      const index = request.insertTable.location?.index ?? fail("insertTable without index");
      const rows = request.insertTable.rows ?? 0;
      const columns = request.insertTable.columns ?? 0;
      insert(index, "\n");
      const { headingId: _, ...para } = paraOf(paragraphAt(index));
      const table: Unit[] = [{ kind: "tableStart" }];
      for (let r = 0; r < rows; r += 1) {
        table.push({ kind: "rowStart" });
        for (let c = 0; c < columns; c += 1) table.push({ kind: "cellStart" }, { kind: "char", ch: "\n", style: {}, para });
      }
      table.push({ kind: "tableEnd" });
      units.splice(index + 1, 0, ...table);
    } else if (request.deleteContentRange) {
      const [s, e] = checkRange(request.deleteContentRange.range);
      if (e > units.length - 1) fail("the body's last newline cannot be deleted");
      let depth = 0;
      for (let i = s; i < e; i += 1) {
        const kind = units[i]?.kind;
        if (kind === "tableStart") depth += 1;
        if (kind === "tableEnd") depth -= 1;
        if ((kind === "rowStart" || kind === "cellStart") && depth === 0) fail("a table cannot be partly deleted");
        if (depth < 0) fail("a table cannot be partly deleted");
      }
      if (depth !== 0) fail("a table cannot be partly deleted");
      if (units[e]?.kind === "tableStart") fail("the newline before a table cannot be deleted");
      units.splice(s, e - s);
    } else if (request.updateParagraphStyle) {
      const [s, e] = checkRange(request.updateParagraphStyle.range);
      const named = request.updateParagraphStyle.paragraphStyle?.namedStyleType;
      if ((request.updateParagraphStyle.fields ?? "").split(",").includes("namedStyleType") && named) {
        for (const p of paragraphsIn(s, e)) {
          const { headingId, ...rest } = paraOf(p);
          setPara(p, { ...rest, named, ...(named.startsWith("HEADING") ? { headingId: headingId ?? newId("h") } : {}) });
        }
      }
    } else if (request.updateTextStyle) {
      const [s, e] = checkRange(request.updateTextStyle.range);
      const fields = (request.updateTextStyle.fields ?? "").split(",");
      const given = (request.updateTextStyle.textStyle ?? {}) as Record<string, unknown>;
      for (let i = s; i < e; i += 1) {
        const u = units[i];
        if (!isChar(u)) continue;
        const next: Record<string, unknown> = { ...u.style };
        for (const f of fields) {
          if (given[f] === undefined) delete next[f];
          else next[f] = given[f];
        }
        units[i] = { ...u, style: next };
      }
    } else if (request.deleteParagraphBullets) {
      const [s, e] = checkRange(request.deleteParagraphBullets.range);
      for (const p of paragraphsIn(s, e)) {
        const { bullet: _, ...rest } = paraOf(p);
        setPara(p, rest);
      }
    } else if (request.createParagraphBullets) {
      const [s, e] = checkRange(request.createParagraphBullets.range);
      const listId = newId("kix");
      lists.set(listId, (request.createParagraphBullets.bulletPreset ?? "").startsWith("NUMBERED"));
      for (const p of paragraphsIn(s, e).reverse()) {
        let tabs = 0;
        while ((units[p.start + tabs] as { ch?: string }).ch === "\t") tabs += 1;
        setPara(p, { ...paraOf(p), bullet: { listId, depth: tabs } });
        units.splice(p.start, tabs);
      }
    } else {
      fail(`unmodelled request ${Object.keys(request).join(",")}`);
    }
  };

  /** The runs of one paragraph [start, end), grouped by identical text style. */
  const paragraphJson = (start: number, end: number): docs_v1.Schema$StructuralElement => {
    const elements: docs_v1.Schema$ParagraphElement[] = [];
    for (let i = start; i < end; i += 1) {
      const u = units[i] as Extract<Unit, { kind: "char" }>;
      const last = elements[elements.length - 1];
      if (last?.textRun && JSON.stringify(last.textRun.textStyle) === JSON.stringify(u.style)) {
        last.textRun.content += u.ch;
        last.endIndex = i + 1;
      } else {
        elements.push({ startIndex: i, endIndex: i + 1, textRun: { content: u.ch, textStyle: { ...u.style } } });
      }
    }
    const para = paraOf({ end });
    return {
      startIndex: start,
      endIndex: end,
      paragraph: {
        elements,
        paragraphStyle: { namedStyleType: para.named, ...(para.headingId ? { headingId: para.headingId } : {}) },
        ...(para.bullet ? { bullet: { listId: para.bullet.listId, nestingLevel: para.bullet.depth } } : {}),
      },
    };
  };

  /** Elements from `i` until a marker that ends the container. */
  const contentFrom = (i: number, stop: (kind: Unit["kind"]) => boolean): [docs_v1.Schema$StructuralElement[], number] => {
    const out: docs_v1.Schema$StructuralElement[] = [];
    while (i < units.length && !stop((units[i] as Unit).kind)) {
      if (units[i]?.kind === "tableStart") {
        const start = i;
        i += 1;
        const tableRows: docs_v1.Schema$TableRow[] = [];
        while (units[i]?.kind === "rowStart") {
          i += 1;
          const tableCells: docs_v1.Schema$TableCell[] = [];
          while (units[i]?.kind === "cellStart") {
            const [content, next] = contentFrom(i + 1, (k) => k !== "char" && k !== "tableStart");
            tableCells.push({ content });
            i = next;
          }
          tableRows.push({ tableCells });
        }
        i += 1; // tableEnd
        out.push({ startIndex: start, endIndex: i, table: { rows: tableRows.length, columns: tableRows[0]?.tableCells?.length ?? 0, tableRows } });
        continue;
      }
      const { start, end } = paragraphAt(i);
      out.push(paragraphJson(start, end));
      i = end;
    }
    return [out, i];
  };

  const glyphs = (ordered: boolean): docs_v1.Schema$NestingLevel[] =>
    Array.from({ length: 9 }, () => (ordered ? { glyphType: "DECIMAL" } : { glyphSymbol: "●" }));

  return {
    applyAll: (requests: readonly unknown[]): void => requests.forEach((r) => apply(r as Request)),
    document: (): docs_v1.Schema$Document => {
      const [content] = contentFrom(1, () => false);
      return {
        documentId: "doc1",
        title: "Simulated",
        revisionId: `rev${units.length}`,
        body: { content: [{ endIndex: 1, sectionBreak: {} }, ...content] },
        lists: Object.fromEntries([...lists].map(([id, ordered]) => [id, { listProperties: { nestingLevels: glyphs(ordered) } }])),
      };
    },
    /** The body as plain text, for an assertion on exactly what landed where. */
    text: (): string => units.map((u) => (u.kind === "char" ? u.ch : u.kind === "sectionBreak" ? "" : `[${u.kind}]`)).join(""),
  };
};
