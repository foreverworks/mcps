/**
 * A fake SPV, behind a fetch function: the F5 sign-in with an e-mailed code,
 * the PrimeFaces message table with its paging request and its downloads, and
 * the request form. It answers the way the real one does (the
 * markup is trimmed to what this server reads), with invented data only.
 */

export const ORIGIN = "https://pfinternet.anaf.ro";
export const FORMS_ORIGIN = "https://formularespv-pf.anaf.ro";
export const CNP = "2990101999999";
export const USERNAME = "ana.popescu";
export const PASSWORD = "correct horse battery staple";

export type FakeRow = {
  readonly type: string;
  readonly requestId?: string;
  readonly posted: string;
  readonly archived: string;
  readonly details: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
};

export const pdf = (text: string): Uint8Array => new TextEncoder().encode(`%PDF-1.4\n${text}\n%%EOF\n`);

export const ROWS: readonly FakeRow[] = [
  {
    type: "DECIZIE",
    posted: "03.03.2026 10:00:00",
    archived: "04.05.2026 10:00:00",
    details: `Decizii de calcul accesorii PF pentru CIF ${CNP}, prelucrata la 02-03-2026`,
    fileName: "SV00000000002.pdf",
    bytes: pdf("decizie accesorii"),
  },
  {
    type: "RASPUNS SOLICITARE",
    requestId: "190000001",
    posted: "02.02.2026 09:00:00",
    archived: "03.04.2026 09:00:00",
    details: `Obligatii de plata pentru CNP ${CNP}`,
    fileName: "190000001_Obligatii_de_plata.pdf",
    bytes: pdf("obligatii"),
  },
  {
    type: "PLATA",
    requestId: "44000001",
    posted: "15.01.2021 08:00:00",
    archived: "15.01.2031 08:00:00",
    details: `Plati pentru CNP ${CNP}`,
    fileName: "44000001_spv_plati.pdf",
    bytes: pdf("plata"),
  },
];

/** The answer to a request, as SPV posts it: a RASPUNS SOLICITARE row whose file is named after the request. */
export const replyRow = (requestId: string, at: string): FakeRow => ({
  type: "RASPUNS SOLICITARE",
  requestId,
  posted: at,
  archived: "01.01.2027 00:00:00",
  details: `Obligatii de plata pentru CNP ${CNP}`,
  fileName: `${requestId}_Obligatii_de_plata.pdf`,
  bytes: pdf(`raspuns ${requestId}`),
});

const SIGN_IN_FORM = `<!DOCTYPE HTML><html><head><title>pfinternet.anaf.ro</title><script>function masterSubmit(f){return true;}</script></head>
<body><noscript>Javascript nu este activat.</noscript>
<form id="auth_form" name="e1" method="post" action="/my.policy" autocomplete="off">
<table><tr><td>Autentificare username &#351;i parol&#259;</td></tr>
%MESSAGE%
<tr><td><input type=text name=username class="credentials_input_text" value="" id="input_1"></td></tr>
<tr><td><input type=password name=password class="credentials_input_password" value="" id="input_2"></td></tr>
<tr><td><input type=submit class="credentials_input_submit" value="Autentificare"></td></tr></table>
<input type=hidden name="vhost" value="standard"></form></body></html>`;

const CODE_FORM = `<!DOCTYPE HTML><html><head><title>pfinternet.anaf.ro</title></head><body>
<form id="auth_form" name="e1" method="post" action="/my.policy" autocomplete="off">
<table><tr><td>Va rugam introduceti codul de siguran&#355;&#259; recep&#355;ionat la adresa de e-mail declarat&#259;, de la adresa Autentificare.SpatiuPrivat@anaf.ro.
Acest cod de siguran&#355;&#259; expir&#259; dup&#259; 300 secunde.</td></tr>
<tr><td><input type=password name=password class="credentials_input_password" value="" id="input_2"></td></tr>
<tr><td><input type=submit class="credentials_input_submit" value="Autentificare"></td></tr></table>
<input type=hidden name="vhost" value="standard"></form></body></html>`;

const signInPage = (message?: string) => SIGN_IN_FORM.replace("%MESSAGE%", message ? `<tr><td class="logon_error">${message}</td></tr>` : "");

const LINK_ID = "j_id2059540600_7ac21901";

const rowHtml = (r: FakeRow, i: number) =>
  `<tr data-ri="${i}" class="ui-widget-content" role="row"><td role="gridcell"><span style="color:black;">${CNP}</span></td>` +
  `<td role="gridcell"><span style="color:black;">${r.type}</span></td>` +
  `<td role="gridcell"><span style="color:black;">${r.requestId ?? ""}</span></td>` +
  `<td role="gridcell"><span style="color:black;">${r.posted}</span></td>` +
  `<td role="gridcell"><a href="#" onclick="return myfaces.oam.submitForm('form','form:MesajeTable:${i}:${LINK_ID}');" class="btn btn-info">PDF</a></td>` +
  `<td role="gridcell" style=" table-layout: fixed;"><span style="color:black;">${r.details}</span></td>` +
  `<td role="gridcell"><span style="color:black;">${r.archived}</span></td></tr>`;

const messagesPage = (rows: readonly FakeRow[], viewState: string) => `<!DOCTYPE html><html><head><title>Mesaje SNM</title>
<script type="text/javascript" src="/SNMD/javax.faces.resource/oamSubmit.js.xhtml?ln=org.apache.myfaces"></script></head><body>
<form id="form" name="form" method="post" action="/SNMD/index.xhtml" enctype="multipart/form-data">
<table><thead><tr><th>CIF</th><th>Tip Document<select id="form:MesajeTable:tipDocument:filter" name="form:MesajeTable:tipDocument:filter"><option value="">--TOATE--</option><option value="DECIZIE">DECIZIE</option></select></th></tr></thead>
<tbody id="form:MesajeTable_data">${rows.slice(0, 20).map(rowHtml).join("")}</tbody></table>
<script id="form:MesajeTable_s" type="text/javascript">$(function(){PrimeFaces.cw('DataTable','myW',{id:'form:MesajeTable',paginator:{id:['form:MesajeTable_paginator_top'],rows:20,rowCount:${rows.length},page:0},filter:true});});</script>
<input type="hidden" name="form_SUBMIT" value="1" /><input type="hidden" name="javax.faces.ViewState" id="javax.faces.ViewState" value="${viewState}" /></form></body></html>`;

const partial = (rows: readonly FakeRow[], first: number, count: number, viewState: string) =>
  `<?xml version="1.0" encoding="utf-8"?><partial-response><changes><update id="form:MesajeTable"><![CDATA[${rows
    .slice(first, first + count)
    .map((r, i) => rowHtml(r, first + i))
    .join("")}]]></update><update id="javax.faces.ViewState"><![CDATA[${viewState}]]></update></changes></partial-response>`;

export const PERSON_TYPES = ["C168", "Duplicat Recipisa", "Duplicat declaratie unica", "Istoric declaratii PF", "Obligatii de plata", "Interogari Banci", "Notificare", "Situatie Sintetica"];

const requestPage = (viewState: string, message?: string) => `<!DOCTYPE html><html><head><title>Adaugare solicitare</title><script src="verificare5.js"></script></head><body>
<input type="hidden" id="PF" name="PF" value="${PERSON_TYPES.join(";")}" />
<form id="form1" name="form1" method="post" action="/SNMD/solicitari.xhtml" enctype="application/x-www-form-urlencoded">
<div>Adauga solicitare:</div>${message === undefined ? "" : `<div class="mesaj">${message}</div>`}
<select id="form1:cui" name="form1:cui" size="1"><option value="${CNP}">${CNP}</option></select>
<select id="form1:TipDocument" name="form1:TipDocument" size="1">${PERSON_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}<option value="Bilant anual">Bilant anual</option></select>
<input id="form1:pui" name="form1:pui" type="text" value="" />
<select id="form1:LunaRaportare" name="form1:LunaRaportare" size="1"><option value=""></option><option value="12">12</option></select>
<input id="form1:AnRaportare" name="form1:AnRaportare" type="text" value="" />
<input id="form1:nrInreg" name="form1:nrInreg" type="text" value="" />
<input id="form1:j_id1809650055_6bdd1248" name="form1:j_id1809650055_6bdd1248" type="submit" value="Trimite" class="buttonm" />
<input type="hidden" name="form1_SUBMIT" value="1" /><input type="hidden" name="javax.faces.ViewState" id="javax.faces.ViewState" value="${viewState}" /></form></body></html>`;

export const COMPANY = "12345678";

const CATEGORIES = [
  ["0", "-----Alegeți categoria din listă-----"],
  ["3", "Asistență și îndrumare de specialitate în domeniul fiscal"],
  ["6", "Solicitare înscriere în audiență"],
  ["1", "Cereri,sesizări sau propuneri (petiții reglementate de OG nr.27/2002)"],
  ["2", "Informații generale de interes public (conform Legii 544/2001)"],
  ["5", "Asistență tehnică servicii informatice"],
] as const;

const SUBCATEGORIES = [
  ["0", "---Alegeți subcategoria din listă---"],
  ["1", "Cazuri de evaziune fiscală"],
  ["30", "Cereri"],
  ["4", "Altele"],
  ["0", "---Alegeți subcategoria din listă---"],
  ["5", "Acte normative, reglementări"],
  ["9", "Altele"],
  ["0", "---Alegeți subcategoria din listă---"],
  ["51", "Spațiul privat virtual"],
  ["58", "Alt domeniu"],
] as const;

const optionsHtml = (list: readonly (readonly [string, string])[], selected?: string) =>
  list.map(([v, l]) => `<option value="${v}"${v === selected ? " selected" : ""}>${l}</option>`).join("");

/**
 * The contact form as SPV serves it (its field inventory, the markup's empty
 * identity select and its script); GetCuiuri lists the company first, so the
 * page preselects it.
 */
const contactPage = () => `<!DOCTYPE html><html><head><title>Formular de contact</title><script src="js/jquery-1.11.1.min.js"></script><script src="/asistspv/js/main.js"></script>
<script type="text/javascript"> $(document).ready(function(){ $.ajaxSetup({ cache: false }); $.ajax({ async: false, url:'GetCuiuri', type:'GET', dataType: 'json',
 success: function(data) { var jsonData = $.parseJSON(JSON.stringify(data)); var $select = $('#standard'); $(jsonData).each(function (index, o) {
 var $option = $("<option/>").attr("value", o.cuicnp).text(o.cuicnp + ' -- ' + o.denumire); $select.append($option); }); }, error: function(e) { } }); });</script></head><body>
<form name="asistForm" method="post" action="/asistspv/asistspatiuprivat.do" enctype="multipart/form-data">
<h3>FORMULAR DE CONTACT</h3><p>(câmpurile marcate cu steluţă sunt obligatorii)</p>
<p>Vă rugăm să alegeţi Codul fiscal/CNP-ul din listă: *</p>
<select name="cif_ales" id="standard"></select>
<p>Alegeți categoria solicitării:*</p><select name="categSolicit" id="categSolicit">${optionsHtml(CATEGORIES, "0")}</select>
<select name="subcategSolicit" id="subcategSolicit">${optionsHtml(SUBCATEGORIES, "0")}</select>
<p>Întrebare: *</p><textarea name="textintrebare" id="textarea" rows="10" cols="80" maxlength="1500"></textarea>
<p>Puteţi introduce maximum: 1500 caractere.</p>
<p>Dacă doriți să atașați un fișier:</p><input type="file" name="docum" id="docum">
<p>Fişierul trebuie să aibă extensia .pdf, .tiff, .rtf, .zip, .jpeg, .jpg, .gif sau .png, să nu depăşească 10 MB şi să nu conţină diacritice în denumire.</p>
<input type="hidden" name="org.apache.struts.taglib.html.TOKEN" value="tok-1">
<button type="submit" name="submit" id="submit" value="submit">Trimite</button></form></body></html>`;

const contactAnswer = (cif: string, number: string, text: string) => `<!DOCTYPE html><html><body><a href="/asistspv/">Înapoi</a>
<p>Cererea/Sesizarea dvs. cu următoarele date:</p><table><tr><td>CNP/CUI:</td><td>${cif}</td></tr><tr><td>Nume:</td><td>POPESCU ANA</td></tr>
<tr><td>Număr de înregistrare:</td><td>${number}</td></tr><tr><td>Data de înregistrare:</td><td>12.10.2026</td></tr>
<tr><td>Text întrebare:</td><td>${text.replace(/\n/g, "<br>")}</td></tr></table><p>a fost trimisă cu succes!</p></body></html>`;

/** formularespv-pf's D212 page (the field inventory), its instruction text included. */
const uploadPage = (viewState: string, said?: string) => `<!DOCTYPE html><html><head><title>Depunere formulare</title></head><body>
<a href="https://formularespv-pf.anaf.ro/exit">Deconectare</a>
<p>Prin intermediul acestei pagini puteţi trimite formulare, doar în nume propriu.</p>
<p>Dacă depunerea se face cu succes, pe ecran se va afişa textul: "Fişierul transmis de dumneavoastră a fost preluat şi a primit indexul de depunere XXXXXXX."</p>
${said === undefined ? "" : `<p style="color:red">${said}</p>`}
<form id="form2" name="form2" method="post" action="/SNMD/d212/d212.xhtml" enctype="multipart/form-data">
<input id="form2:j_id217840501_cfbfb00" name="form2:j_id217840501_cfbfb00" type="file" />
<input id="form2:j_id217840501_cfbfbf7" name="form2:j_id217840501_cfbfbf7" type="submit" value="Transmitere formular" />
<input type="hidden" name="form2_SUBMIT" value="1" /><input type="hidden" name="javax.faces.ViewState" id="javax.faces.ViewState" value="${viewState}" /></form>
<a href="https://formularespv-pf.anaf.ro/declaratii/duf">Declaratia unica - 2026</a></body></html>`;

/** What the fake's contact form received. */
export type ContactPost = {
  readonly fields: Readonly<Record<string, string>>;
  readonly file: { readonly name: string; readonly type: string; readonly bytes: Uint8Array } | undefined;
};

type Body = URLSearchParams | FormData | undefined;

const field = (body: Body, name: string): string | undefined => {
  if (body === undefined) return undefined;
  const v = body.get(name);
  return typeof v === "string" ? v : undefined;
};

export type FakeSpvOptions = {
  /** Called with each code SPV "e-mails". */
  readonly mail: (code: string) => void;
  readonly rows?: FakeRow[];
  /** A request type SPV refuses, and in which words. */
  readonly refuse?: { readonly type: string; readonly message: string };
};

/**
 * The fake. `state` is what a test inspects: how many passwords and codes
 * were posted, the sessions alive, the requests registered, the downloads.
 */
export const makeFakeSpv = (options: FakeSpvOptions) => {
  const rows = options.rows ?? [...ROWS];
  let counter = 0;
  const next = (prefix: string) => `${prefix}${++counter}`;
  /** An F5 session; `rendered` is the list the session's message page last rendered, which a download's row index points into, as SPV's session-scoped table does. */
  type F5 = { stage: "password" | "code" | "in"; code?: string; rendered?: readonly FakeRow[] };
  const f5 = new Map<string, F5>();
  const state = {
    passwordPosts: 0,
    codePosts: 0,
    downloads: [] as string[],
    requests: [] as Record<string, string>[],
    replies: 0,
    /** The codes SPV sent, newest last. */
    codes: [] as string[],
    /** GETs of the message list: listings and keepalive probes. */
    pageLoads: 0,
    /** Set by a test: the session ends just before the next download. */
    expireBeforeDownload: false,
    /** Set by a test: rows SPV posts right after it serves the next listing, ahead of the others. */
    arriving: [] as FakeRow[],
    /** Set by a test: how long SPV takes to answer each request, so calls made together overlap. */
    latencyMs: 0,
    /** Requests SPV refused. */
    refusals: 0,
    /** What the contact form received, in order. */
    contacts: [] as ContactPost[],
    /** Set by a test: the contact form answers a post with itself, without a word. */
    contactSilently: false,
    /** What formularespv-pf received: the file posted and the fields beside it. */
    uploads: [] as { readonly fields: Readonly<Record<string, string>>; readonly file: { readonly name: string; readonly bytes: Uint8Array } }[],
    /** Set by a test: formularespv-pf refuses the next upload in these words. */
    uploadRefusal: undefined as string | undefined,
  };

  const redirect = (location: string, cookies: string[] = []) => {
    const headers = new Headers({ location });
    for (const c of cookies) headers.append("set-cookie", c);
    return new Response(null, { status: 302, headers });
  };
  const html = (body: string, cookies: string[] = []) => {
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    for (const c of cookies) headers.append("set-cookie", c);
    return new Response(body, { status: 200, headers });
  };

  const cookiesOf = (header: string | null): Map<string, string> =>
    new Map(
      (header ?? "")
        .split(";")
        .map((p) => p.trim())
        .filter((p) => p.includes("="))
        .map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)] as [string, string]),
    );

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== ORIGIN && url.origin !== FORMS_ORIGIN) return new Response("not this fake", { status: 404 });
    if (state.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, state.latencyMs));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const jar = cookiesOf(headers.get("cookie"));
    const body = init?.body as Body;
    const mrh = jar.get("MRHSession");
    const session = mrh === undefined ? undefined : f5.get(mrh);
    const fresh = () => {
      const id = next("mrh-");
      f5.set(id, { stage: "password" });
      return [`LastMRH_Session=${id.slice(-8)};path=/;secure`, `MRHSession=${id};path=/;secure`];
    };
    const signedIn = session?.stage === "in";

    if (url.pathname === "/" && method === "GET") return signedIn ? redirect("/anaf/myinternet/SPV") : redirect("/my.policy", session ? [] : fresh());
    if (url.pathname === "/anaf/myinternet/SPV") return html("<html><body>SPV Buletin Fiscal</body></html>", [`JSESSIONID=${next("js-")}; Path=/; HttpOnly`]);
    if (url.pathname === "/my.policy" && method === "GET") return html(signInPage(), session ? [] : fresh());
    if (url.pathname === "/my.policy" && method === "POST") {
      if (session === undefined) return html(signInPage("Sesiune expirata"), fresh());
      if (session.stage === "password") {
        state.passwordPosts += 1;
        if (field(body, "username") !== USERNAME || field(body, "password") !== PASSWORD) return html(signInPage("Autentificare esuata. Utilizator sau parola incorecte."));
        session.stage = "code";
        session.code = String(100000 + ((state.passwordPosts * 7919 + 13) % 900000));
        state.codes.push(session.code);
        options.mail(session.code);
        return html(CODE_FORM);
      }
      if (session.stage === "code") {
        state.codePosts += 1;
        if (field(body, "password") !== session.code) {
          f5.delete(mrh ?? "");
          return html(signInPage("Codul de siguranta este incorect."), fresh());
        }
        session.stage = "in";
        return redirect("/", [`LtpaToken2=${next("ltpa-")}; Path=/; HttpOnly`]);
      }
    }
    if (url.pathname === "/vdesk/hangup.php3") {
      if (mrh !== undefined) f5.delete(mrh);
      return html("<html><body>Sesiune inchisa</body></html>");
    }
    if (url.pathname === "/SNMD/index.xhtml" && method === "GET") state.pageLoads += 1;
    if ((url.pathname.startsWith("/SNMD/") || url.pathname.startsWith("/asistspv/")) && !signedIn) return redirect(method === "POST" ? url.pathname : "/my.policy");

    if (url.origin === FORMS_ORIGIN && url.pathname === "/SNMD/d212/d212.xhtml") {
      if (method === "GET") return html(uploadPage(next("vs-")));
      const form = body as FormData;
      const fields: Record<string, string> = {};
      let file: { name: string; bytes: Uint8Array } | undefined;
      for (const [name, value] of form.entries()) {
        if (typeof value === "string") fields[name] = value;
        else file = { name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) };
      }
      if (file === undefined || fields["javax.faces.ViewState"] === undefined) return html(uploadPage(next("vs-")));
      state.uploads.push({ fields, file });
      if (state.uploadRefusal !== undefined) {
        const said = state.uploadRefusal;
        state.uploadRefusal = undefined;
        return html(uploadPage(next("vs-"), said));
      }
      const index = String(16000000 + state.uploads.length);
      const registration = String(1200000000 + state.uploads.length);
      // SPV posts the declaration and its receipt within seconds.
      rows.unshift(
        { type: "RECIPISA", posted: "12.10.2026 23:00:08", archived: "12.12.2026 23:00:08", details: `recipisa pentru CIF ${CNP}, tip D212, numar_inregistrare INTERNT-${registration}-2026/12-10-2026, perioada raportare 12.2025`, fileName: `${registration}.pdf`, bytes: pdf(`recipisa ${registration}`) },
        { type: "DECLARATIE", posted: "12.10.2026 23:00:05", archived: "12.12.2026 23:00:05", details: `depunere declaratie unica pentru CIF ${CNP} pentru anul 2025 si luna 12`, fileName: `${index}_depunere.pdf`, bytes: pdf(`declaratie ${index}`) },
      );
      return html(uploadPage(next("vs-"), `Fisierul transmis de dumneavoastra a fost preluat si a primit indexul de depunere: ${index}. Veti primi un mesaj pe adresa dumneavoastra de email.`));
    }
    if (url.pathname === "/asistspv/" && method === "GET") return html(contactPage(), ["JSESSIONID=asist-1; Path=/asistspv; HttpOnly"]);
    if (url.pathname === "/asistspv/GetCuiuri" && method === "GET") {
      const listed = [
        { cuicnp: COMPANY, denumire: "EXEMPLU S.R.L." },
        { cuicnp: CNP, denumire: "POPESCU ANA" },
      ];
      return new Response(JSON.stringify(listed), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/asistspv/asistspatiuprivat.do" && method === "POST") {
      const form = body as FormData;
      const fields: Record<string, string> = {};
      let file: ContactPost["file"];
      for (const [name, value] of form.entries()) {
        if (typeof value === "string") fields[name] = value;
        else if (value.size > 0 || value.name !== "") file = { name: value.name, type: value.type, bytes: new Uint8Array(await value.arrayBuffer()) };
      }
      state.contacts.push({ fields, file });
      const text = fields["textintrebare"] ?? "";
      // Like the public form: a post missing its category or text renders the form again, without a word.
      if (state.contactSilently || (fields["categSolicit"] ?? "0") === "0" || text.trim() === "") return html(contactPage());
      return html(contactAnswer(fields["cif_ales"] ?? "", String(50000000000 + state.contacts.length), text));
    }

    if (url.pathname === "/SNMD/index.xhtml") {
      const flash = ["oam.Flash.RENDERMAP.TOKEN=x; Path=/SNMD; HttpOnly"];
      if (method === "GET") {
        if (session !== undefined) session.rendered = [...rows];
        return html(messagesPage(rows, next("vs-")), flash);
      }
      if (headers.get("faces-request") === "partial/ajax") {
        const first = Number(field(body, "form:MesajeTable_first") ?? "0");
        const count = Number(field(body, "form:MesajeTable_rows") ?? "20");
        if (session !== undefined) session.rendered = [...rows];
        const answer = partial(rows, first, count, next("vs-"));
        rows.unshift(...state.arriving.splice(0));
        return new Response(answer, { status: 200, headers: { "content-type": "text/xml;charset=UTF-8" } });
      }
      if (state.expireBeforeDownload) {
        state.expireBeforeDownload = false;
        if (session !== undefined) session.stage = "password";
        return redirect(url.pathname);
      }
      const link = field(body, "form:_idcl") ?? "";
      const index = Number(/^form:MesajeTable:(\d+):/.exec(link)?.[1] ?? "-1");
      const row = (session?.rendered ?? rows)[index];
      if (row === undefined || field(body, "javax.faces.ViewState") === undefined) return html(messagesPage(rows, next("vs-")));
      state.downloads.push(row.fileName);
      return new Response(row.bytes, { status: 200, headers: { "content-type": "application/pdf", "content-disposition": `attachment;filename="${row.fileName}"` } });
    }

    if (url.pathname === "/SNMD/solicitari.xhtml") {
      if (method === "GET") return html(requestPage(next("vs-")));
      const sent = Object.fromEntries([...(body as URLSearchParams).entries()]);
      const type = sent["form1:TipDocument"] ?? "";
      if (options.refuse?.type === type) {
        state.refusals += 1;
        return html(requestPage(next("vs-"), options.refuse.message));
      }
      const id = String(192000000 + state.requests.length + 1);
      state.requests.push(sent);
      return html(requestPage(next("vs-"), `Solicitarea a fost inregistrata cu id=${id}`));
    }
    return new Response("not found", { status: 404 });
  };

  return {
    fetch: fetch as typeof globalThis.fetch,
    state,
    rows,
    /** SPV ends every session (an idle timeout, a restart). */
    expireAll: () => {
      for (const s of f5.values()) if (s.stage === "in") s.stage = "password";
    },
    /** SPV posts the answer to a registered request. */
    reply: (requestId: string, at: string) => {
      state.replies += 1;
      rows.unshift(replyRow(requestId, at));
    },
  };
};
