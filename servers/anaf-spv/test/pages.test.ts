import { describe, expect, it } from "vitest";

import { decodeEntities, options, visibleText } from "../src/infra/portal/html.js";
import { addedLines, partialUpdates, requestFormIn, requestIdIn, rowCountIn, rowsIn, servedFileName, signInMessage, signInStage } from "../src/infra/portal/pages.js";
import { contactAnswerIn, contactFormIn, identitiesIn } from "../src/infra/portal/contact.js";
import { errorOf } from "./helpers.js";

const SIGN_IN = `<form id="auth_form" action="/my.policy"><input type=text name=username value=""><input type=password name=password value=""><input type=hidden name="vhost" value="standard"></form>`;
const CODE = `<form id="auth_form" action="/my.policy"><td>Va rugam introduceti codul de siguran&#355;&#259; recep&#355;ionat</td><input type=password name=password value=""></form>`;
const REFUSED = `<noscript>Javascript nu este activat. Pentru deschiderea unei sesiuni noi va rugam apasati aici.</noscript><td class="logon_error">Autentificare esuata.</td>${SIGN_IN}`;

describe("the sign-in pages", () => {
  it("tells the password step from the code step", () => {
    expect(signInStage(SIGN_IN)).toBe("password");
    expect(signInStage(CODE)).toBe("code");
    expect(signInStage("<html><body>SPV</body></html>")).toBe("other");
  });

  it("keeps SPV's words and drops the form's fixed text", () => {
    expect(signInMessage(REFUSED)).toBe("Autentificare esuata.");
    expect(signInMessage(SIGN_IN)).toBe("SPV showed the sign-in form again without a message");
  });
});

const ROW = (i: number, posted = "02.02.2026 09:00:00") =>
  `<tr data-ri="${i}" class="ui-widget-content" role="row"><td role="gridcell"><span>2990101999999</span></td><td role="gridcell"><span>RASPUNS SOLICITARE</span></td>` +
  `<td role="gridcell"><span>190000001</span></td><td role="gridcell"><span>${posted}</span></td>` +
  `<td role="gridcell"><a href="#" onclick="return myfaces.oam.submitForm('form','form:MesajeTable:${i}:j_id1');">PDF</a></td>` +
  `<td role="gridcell" style="x"><span>Obligatii de plata pentru CNP 2990101999999 &amp; altele</span></td><td role="gridcell"><span>03.04.2026 09:00:00</span></td></tr>`;

describe("the message list", () => {
  it("reads a row's seven cells and its link", () => {
    const [r] = rowsIn(ROW(6));
    expect(r).toMatchObject({ cif: "2990101999999", type: "RASPUNS SOLICITARE", requestId: "190000001", details: "Obligatii de plata pentru CNP 2990101999999 & altele", link: "form:MesajeTable:6:j_id1" });
    expect(r?.postedAtMs).toBe(Date.UTC(2026, 1, 2, 7, 0, 0));
  });

  it("calls a row it cannot read drift, never a skipped row", async () => {
    expect((await errorOf(() => rowsIn(ROW(0, "yesterday"))))?.kind).toBe("drift");
    expect((await errorOf(() => rowsIn('<tr data-ri="0"><td>1</td></tr>')))?.message).toContain("1 cells");
  });

  it("reads the paging answer and the table's row count", () => {
    const xml = `<?xml version="1.0"?><partial-response><changes><update id="form:MesajeTable"><![CDATA[${ROW(0)}${ROW(1)}]]></update><update id="javax.faces.ViewState"><![CDATA[vs-2]]></update></changes></partial-response>`;
    const updates = partialUpdates(xml);
    expect(rowsIn(updates.get("form:MesajeTable") ?? "")).toHaveLength(2);
    expect(updates.get("javax.faces.ViewState")).toBe("vs-2");
    expect(rowCountIn("PrimeFaces.cw('DataTable','myW',{id:'form:MesajeTable',paginator:{id:['x'],rows:20,rowCount:42,page:0},filter:true})")).toBe(42);
  });

  it("takes the file name SPV serves", () => {
    expect(servedFileName(new Headers({ "content-disposition": 'attachment;filename="SV00000000001.pdf"' }))).toBe("SV00000000001.pdf");
    expect(servedFileName(new Headers({ "content-disposition": "attachment; filename*=UTF-8''raport%20F2102.pdf" }))).toBe("raport F2102.pdf");
    expect(servedFileName(new Headers())).toBeUndefined();
  });
});

describe("the request form", () => {
  const FORM = `<input type="hidden" id="PF" name="PF" value="C168;Obligatii de plata;Duplicat declaratie unica" />
<form id="form1" name="form1" method="post"><select id="form1:cui" name="form1:cui"><option value="2990101999999">2990101999999</option><option value="12345678">12345678</option></select>
<select name="form1:TipDocument"><option value="C168">C168</option><option value="Bilant anual">Bilant anual</option></select>
<input id="form1:j_id9" name="form1:j_id9" type="submit" value="Trimite" /><input type="hidden" name="javax.faces.ViewState" value="vs-1" /></form>`;

  it("reads the identities, both type lists and the generated submit name", () => {
    expect(requestFormIn(FORM)).toEqual({
      identities: ["2990101999999", "12345678"],
      personTypes: ["C168", "Obligatii de plata", "Duplicat declaratie unica"],
      companyTypes: [],
      submitName: "form1:j_id9",
      viewState: "vs-1",
    });
  });

  it("falls back to the select when the page has no PF list", () => {
    expect(requestFormIn(FORM.replace(/<input type="hidden" id="PF"[^>]*>/, "")).personTypes).toEqual(["C168", "Bilant anual"]);
  });

  it("finds the registered id, or what the answer added to the page", () => {
    expect(requestIdIn("<div>Solicitarea a fost &#238;nregistrat&#259; cu id=192000123</div>")).toBe("192000123");
    expect(requestIdIn("<div>Solicitarea a fost inregistrata cu id=192000123</div>")).toBe("192000123");
    expect(requestIdIn("<div>Solicitarea a fost inregistrată cu id = 7</div>")).toBe("7");
    expect(addedLines(`<div>Adauga</div>${FORM}`, `<div>Adauga</div><div>Nu exista date.</div>${FORM}`)).toEqual(["Nu exista date."]);
  });
});

describe("html", () => {
  it("decodes entities and reads options", () => {
    expect(decodeEntities("&#351;i &#x103; &amp; &nbsp;&bogus;")).toBe("şi ă &  &bogus;");
    expect(options('<select><option value="a">A</option><option>B &amp; C</option></select>')).toEqual([
      { value: "a", label: "A" },
      { value: "B & C", label: "B & C" },
    ]);
    expect(visibleText("<script>x</script><p>Un  text</p><!-- c -->")).toBe("Un text");
  });
});

describe("the contact form", () => {
  const BASE = new URL("https://pfinternet.anaf.ro/asistspv/");
  const FORM = `<form name="f" method="post" action="asistspatiuprivat.do" enctype="multipart/form-data">
<select name="cif_ales"><option value="12345678" selected>12345678 -- EXEMPLU S.R.L.</option><option value="2990101999999">2990101999999 -- POPESCU ANA</option></select>
<select name="categSolicit"><option value="0">--</option><option value="3">Asisten&#539;&#259;</option><option value="1">Cereri</option></select>
<select name="subcategSolicit"><option value="0">--</option><option value="30">Cereri</option><option value="0">--</option><option value="5">Acte</option><option value="0">--</option><option value="51">SPV</option></select>
<textarea name="textintrebare" maxlength="1500"></textarea><input type="file" name="docum"><input type="hidden" name="t" value="1">
<button type="submit" name="submit" value="submit">Trimite</button></form>`;

  it("reads the identities, the one preselected, the categories, the subcategory groups and what a post needs", () => {
    expect(contactFormIn(FORM, BASE)).toEqual({
      action: "/asistspv/asistspatiuprivat.do",
      identitiesFrom: undefined,
      identities: [
        { value: "12345678", label: "12345678 -- EXEMPLU S.R.L." },
        { value: "2990101999999", label: "2990101999999 -- POPESCU ANA" },
      ],
      preselected: "12345678",
      categories: [
        { value: "3", label: "Asistență" },
        { value: "1", label: "Cereri" },
      ],
      subcategoryGroups: [
        { category: undefined, choices: [{ value: "30", label: "Cereri" }] },
        { category: undefined, choices: [{ value: "5", label: "Acte" }] },
        { category: undefined, choices: [{ value: "51", label: "SPV" }] },
      ],
      textMax: 1500,
      hidden: [["t", "1"]],
      submit: ["submit", "submit"],
    });
  });

  it("reads options as ANAF's public form writes them: wrapped labels, retired ones in comments, groups marked by data-xxx", () => {
    const PUBLIC = FORM.replace(
      /<select name="categSolicit">[\s\S]*?<\/select>\n<select name="subcategSolicit">[\s\S]*?<\/select>/,
      `<select name="categSolicit"><option value="0" selected="selected">--
        Alegeti</option><option value="3">Asistență și îndrumare de specialitate
          în domeniul fiscal</option><!-- <option value="9">Retrasă</option> --></select>
<select name="subcategSolicit"><option value="0" data-xxx="1">--</option><option value="30" data-xxx="1">Cereri</option>
<!-- <option value="33" data-xxx="1">Prima Casă</option> --><option value="0" data-xxx="5">--</option><option value="51" data-xxx="5">Spațiul privat
  virtual</option></select>`,
    );
    const form = contactFormIn(PUBLIC, BASE);
    expect(form.categories).toEqual([{ value: "3", label: "Asistență și îndrumare de specialitate în domeniul fiscal" }]);
    expect(form.subcategoryGroups).toEqual([
      { category: "1", choices: [{ value: "30", label: "Cereri" }] },
      { category: "5", choices: [{ value: "51", label: "Spațiul privat virtual" }] },
    ]);
  });

  it("finds where the page's script fetches the identities when the markup has none, and reads that list", async () => {
    const SCRIPTED = FORM.replace(/<select name="cif_ales">[\s\S]*?<\/select>/, '<select name="cif_ales" id="standard"></select>').replace(
      "</form>",
      "</form><script>$(document).ready(function(){ $.ajax({ async: false, url:'GetCuiuri', type:'GET', success: function(d) { var $select = $('#standard'); } }); });</script>",
    );
    expect(contactFormIn(SCRIPTED, BASE)).toMatchObject({ identitiesFrom: "/asistspv/GetCuiuri", identities: [] });
    expect(identitiesIn([{ cuicnp: "12345678", denumire: "EXEMPLU S.R.L." }, { cuicnp: 2990101999999, denumire: "POPESCU ANA" }])).toEqual([
      { value: "12345678", label: "12345678 -- EXEMPLU S.R.L." },
      { value: "2990101999999", label: "2990101999999 -- POPESCU ANA" },
    ]);
    expect((await errorOf(() => identitiesIn([{ eroare: "Nu aveti drepturi" }])))?.message).toContain("Nu aveti drepturi");
    expect((await errorOf(() => identitiesIn({})))?.kind).toBe("drift");
  });

  it("calls a page without the form drift, and says what an empty identity list looks like", async () => {
    const empty = await errorOf(() => contactFormIn(FORM.replace(/<select name="cif_ales">[\s\S]*?<\/select>/, '<select name="cif_ales"></select><script>fill("cif_ales")</script>'), BASE));
    expect(empty?.kind).toBe("drift");
    expect(empty?.message).toContain('<select name="cif_ales"></select>; scripts loaded: none; inline script: fill("cif_ales")');
    expect((await errorOf(() => contactFormIn("<html><body>Sesiune expirata</body></html>", BASE)))?.kind).toBe("drift");
    expect((await errorOf(() => contactFormIn(FORM.replace('name="docum"', 'name="x"'), BASE)))?.message).toContain("docum");
  });

  it("reads the confirmation, and tells a page that registered nothing", async () => {
    const OK = "<p>Cererea/Sesizarea dvs. cu următoarele date:</p><td>CNP/CUI:</td><td>2990101999999</td><td>Număr de înregistrare:</td><td>50000000001</td>" +
      "<td>Data de înregistrare:</td><td>12.10.2026</td><td>Text întrebare:</td><td>Buna ziua<br>Multumesc</td><p>a fost trimisă cu succes!</p>";
    expect(contactAnswerIn(OK)).toEqual({
      kind: "registered",
      registered: { registrationNumber: "50000000001", registeredOn: "12.10.2026", shownCif: "2990101999999", shownText: "Buna ziua Multumesc" },
    });
    expect(contactAnswerIn(FORM)).toEqual({ kind: "not_registered" });
    expect((await errorOf(() => contactAnswerIn("<p>Cererea a fost trimisa cu succes!</p>")))?.kind).toBe("drift");
  });
});
