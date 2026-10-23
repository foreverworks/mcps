/**
 * Records as the registers return them, trimmed to a few marks. The US ones
 * keep the shape of a real answer from tmsearch.uspto.gov, cut to the fields
 * the server asks for; every mark, owner, number, date and score is invented.
 */
type UsptoHit = { readonly id: string; readonly score: number; readonly source: Readonly<Record<string, unknown>> };

export const usptoHits: readonly UsptoHit[] = [
  {
    id: "90000001",
    score: 80,
    source: {
      id: "90000001",
      wordmark: "TURNIP",
      alive: true,
      statusCode: 700,
      statusDescription: "REGISTERED",
      filedDate: "2021-03-15T00:00:00",
      registrationDate: "2022-09-06",
      registrationId: "7000001",
      abandonDate: null,
      cancelDate: null,
      internationalClass: ["IC 042"],
      ownerName: ["EXAMPLE SOFTWARE, INC. (CORPORATION; OREGON, USA)"],
      drawingCode: 4,
      translation: null,
    },
  },
  {
    id: "90000002",
    score: 70,
    source: {
      id: "90000002",
      wordmark: "TURNIP",
      alive: true,
      statusCode: 641,
      statusDescription: "NON-FINAL ACTION - MAILED",
      filedDate: "2026-01-12T00:00:00",
      registrationDate: null,
      registrationId: null,
      internationalClass: ["IC 042", "IC 009", "IC 035"],
      ownerName: ["Example Media, LLC (LIMITED LIABILITY COMPANY; Texas, USA)"],
      drawingCode: 4,
    },
  },
  {
    id: "90000003",
    score: 60,
    source: {
      id: "90000003",
      wordmark: "TURNIP",
      alive: true,
      statusDescription: "REGISTERED AND RENEWED",
      filedDate: "2012-09-10T00:00:00",
      registrationDate: "2013-05-14",
      registrationId: "4000002",
      internationalClass: ["IC 007", "IC 020", "(CANCELLED) IC 035"],
      ownerName: ["Example Holdings Limited (COMPANY; IRELAND)"],
      drawingCode: 4,
    },
  },
  {
    id: "90000004",
    score: 50,
    source: {
      id: "90000004",
      wordmark: "TURNIP",
      alive: false,
      statusDescription: "CANCELLED - SECTION 8",
      filedDate: "2003-02-03T00:00:00",
      registrationDate: "2006-11-21",
      registrationId: "3000003",
      internationalClass: ["(CANCELLED) IC 016", "(CANCELLED) IC 035", "(CANCELLED) IC 042"],
      ownerName: ["Example Old Co. (CORPORATION; OHIO, USA)"],
      drawingCode: 4,
    },
  },
  {
    id: "90000005",
    score: 40,
    source: {
      id: "90000005",
      wordmark: "TURNIP QPT",
      alive: true,
      statusDescription: "REGISTERED",
      filedDate: "2022-08-08T00:00:00",
      registrationDate: "2023-06-20",
      registrationId: "7200005",
      internationalClass: ["IC 009"],
      ownerName: ["EXAMPLE TECH CO., LTD. (LIMITED LIABILITY COMPANY; SINGAPORE)"],
      drawingCode: 3,
    },
  },
  {
    id: "90000006",
    score: 20,
    source: {
      id: "90000006",
      wordmark: "NABEK",
      alive: true,
      statusDescription: "REGISTERED",
      filedDate: "2021-11-02T00:00:00",
      registrationDate: "2022-08-16",
      registrationId: "6900006",
      internationalClass: ["IC 009"],
      ownerName: ["EXAMPLE TRADING LTD. (limited company (ltd.); Malta)"],
      drawingCode: 4,
      translation: 'The English translation of NABEK in the mark is "turnip".',
    },
  },
  {
    id: "88000001",
    score: 10,
    source: { id: "88000001", wordmark: null, alive: true, statusDescription: "REGISTERED", registrationId: "6000001", internationalClass: ["IC 025"], drawingCode: 2 },
  },
];

export const usptoAnswer = (hits: readonly UsptoHit[] = usptoHits, total = 42) => ({
  took: 12,
  timedOut: false,
  hits: { totalValue: total, totalRelation: "eq", maxScore: 80, hits: hits.map((h) => ({ index: "tmsearch-index", type: "_doc", ...h })) },
});

export const usptoDetail: Readonly<Record<string, unknown>> = {
  ...usptoHits[0]?.source,
  goodsAndServices: [
    `IC 042: Software as a service (SAAS) services featuring software for scheduling example widgets, ${"widgets ".repeat(80)}end.`,
    "(CANCELLED) IC 035: [ Business consultancy ].",
  ],
};

export const euipoPage = {
  trademarks: [
    {
      applicationNumber: "018900001",
      markKind: "INDIVIDUAL",
      markFeature: "WORD",
      markBasis: "EU_TRADEMARK",
      wordMarkSpecification: { verbalElement: "Turnip" },
      niceClasses: [42, 9],
      applicants: [{ office: "EM", identifier: "1", name: "Turnip Software Inc." }],
      applicationDate: "2024-03-01",
      registrationDate: "2024-07-10",
      status: "REGISTERED",
    },
    {
      applicationNumber: "019100002",
      markFeature: "FIGURATIVE",
      wordMarkSpecification: { verbalElement: "TURNIP LABS" },
      niceClasses: [35],
      applicationDate: "2026-02-11",
      status: "OPPOSITION_PENDING",
    },
    { applicationNumber: "W01700003", markFeature: "WORD", markBasis: "INTERNATIONAL_TRADEMARK", wordMarkSpecification: { verbalElement: "Turnipex" }, niceClasses: [9], status: "UNDER_EXAMINATION" },
  ],
  size: 100,
  totalElements: 3,
  totalPages: 1,
  page: 0,
};

export const euipoDetail = {
  ...euipoPage.trademarks[0],
  applicationLanguage: "en",
  expiryDate: "2034-03-01",
  statusDate: "2024-07-11",
  goodsAndServices: [
    { classNumber: 9, description: [{ language: "de", terms: ["Software"] }, { language: "en", terms: ["Software", "Downloadable applications"] }] },
    { classNumber: 42, description: [{ language: "fr", terms: ["Logiciel-service [SaaS]"] }] },
  ],
};

/**
 * TSDR's answers, in the shape recorded from tsdrapi.uspto.gov on 2026-10-22
 * (status JSON, document list XML), every identifier, name, address and date
 * invented. Fields this server does not read are kept, so a test shows they
 * pass unread.
 */
export const tsdrStatus = (over: Readonly<Record<string, unknown>> = {}, history: readonly unknown[] = tsdrHistory) => ({
  trademarks: [
    {
      status: {
        serialNumber: 97000001,
        usRegistrationNumber: "7100001",
        markElement: "TURNIP",
        status: 800,
        extStatusDesc: "The registration has been renewed.",
        statusDate: "2021-03-01",
        filingDate: "2010-01-04",
        usRegistrationDate: "2011-02-01",
        tm5Status: 8,
        tm5StatusDesc: "LIVE/REGISTRATION/Issued and Active",
        tm5StatusDef: "The trademark application has been registered with the Office.",
        dateAbandoned: null,
        dateRenewal: "2021-02-01",
        markDrawingCd: "4",
        correspondence: { individualFullName: "Ana Popescu", correspondantEmail: { addresses: ["ana@example.com"] } },
        ...over,
      },
      parties: { ownerGroups: { "30": [{ name: "EXAMPLE SOFTWARE, INC.", city: "Springfield" }] } },
      gsList: [{ primeClassCode: "042", statusDescription: "ACTIVE", description: "Software as a service" }],
      prosecutionHistory: history,
    },
  ],
});

export const tsdrHistory: readonly unknown[] = [
  { entryNumber: 3, entryCode: "CHAN", entryType: "I", proceedingNum: 0, entryDate: "2022-06-14T04:00:00.000+0000", entryDesc: "APPLICANT/CORRESPONDENCE CHANGES (NON-RESPONSIVE) ENTERED" },
  { entryNumber: 1, entryCode: "NWAP", entryType: "I", proceedingNum: 0, entryDate: "2010-01-07T05:00:00.000+0000", entryDesc: "NEW APPLICATION ENTERED" },
  { entryNumber: 2, entryCode: "R.PR", entryType: "A", proceedingNum: 0, entryDate: "2011-02-01T05:00:00.000+0000", entryDesc: "REGISTERED-PRINCIPAL REGISTER " },
  { entryNumber: 4, entryCode: "X", entryType: "I", proceedingNum: 0, entryDate: null, entryDesc: "AN UNDATED NOTE" },
];

export const tsdrDocuments = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><DocumentList xmlns="urn:us:gov:doc:uspto:trademark">\
<Document><SerialNumber>97000001</SerialNumber><DocumentTypeCode>SPE</DocumentTypeCode><DocumentTypeCodeDescriptionText>Specimen</DocumentTypeCodeDescriptionText><DocumentTypeDescriptionText>Specimen</DocumentTypeDescriptionText><CategoryTypeCode>I</CategoryTypeCode><CategoryTypeCodeDescriptionText>Incoming</CategoryTypeCodeDescriptionText><MailRoomDate>2010-01-04-05:00</MailRoomDate><ScanDateTime>2010-01-05T09:00:00.000-05:00</ScanDateTime><TotalPageQuantity>2</TotalPageQuantity><PageMediaTypeList><PageMediaTypeName>image/jpeg</PageMediaTypeName></PageMediaTypeList></Document>\
<Document><SerialNumber>97000001</SerialNumber><DocumentTypeCode>ACR</DocumentTypeCode><DocumentTypeCodeDescriptionText>Notice-Acceptance-Renewal</DocumentTypeCodeDescriptionText><DocumentTypeDescriptionText>Notc-Accept-Renewal</DocumentTypeDescriptionText><CategoryTypeCode>O</CategoryTypeCode><CategoryTypeCodeDescriptionText>Outgoing</CategoryTypeCodeDescriptionText><MailRoomDate>2021-03-01-05:00</MailRoomDate><ScanDateTime>2021-03-01T23:10:32.000-05:00</ScanDateTime><TotalPageQuantity>1</TotalPageQuantity><PageMediaTypeList><PageMediaTypeName>application/xml</PageMediaTypeName></PageMediaTypeList></Document>\
<Document><SerialNumber>97000001</SerialNumber><DocumentTypeCode>OOA</DocumentTypeCode><DocumentTypeCodeDescriptionText>Offc Action Outgoing &amp; Notes</DocumentTypeCodeDescriptionText><CategoryTypeCode>O</CategoryTypeCode><CategoryTypeCodeDescriptionText>Outgoing</CategoryTypeCodeDescriptionText><MailRoomDate>2010-06-01-04:00</MailRoomDate><TotalPageQuantity>5</TotalPageQuantity></Document>\
</DocumentList>`;

export const PDF_TEXT = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n";
