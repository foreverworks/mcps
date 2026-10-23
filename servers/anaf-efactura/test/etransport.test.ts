import { describe, expect, it } from "vitest";

import { declarationListing } from "../src/domain/etransport.js";

/** Rows as ANAF's own lista.html example shows them (one valid, one refused). */
const listing = {
  mesaje: [
    {
      uit: "XAXAXAXAXAXAXAXA1",
      cod_decl: "8000000000",
      sursa: "A",
      id_incarcare: "0000000001",
      data_creare: "20221010144008",
      tip_op: "30",
      data_transp: "20221010000000",
      pc_tara: "RO",
      pc_cod: "8000000000",
      pc_den: "SC TEST SRL",
      tr_tara: "RO",
      tr_cod: "8000000000",
      tr_den: "SC TEST SRL",
      nr_veh: "B00AAA",
    },
    {
      cod_decl: "8000000000",
      sursa: "A",
      id_incarcare: "0000000003",
      data_creare: "20221011073136",
      mesaje: [{ tip: "ERR", mesaj: "Nu a fost identificat UIT-ul printre notificarile valide anterioare." }],
    },
  ],
  serial: "XXXX",
  cui: "1000000000001,8000000000",
  titlu: "Lista Mesaje disponibile din ultimele 1 zile",
  dateResponse: "202210111242",
  ExecutionStatus: 0,
  trace_id: "680bdefd",
};

describe("declarationListing", () => {
  it("maps a valid declaration into who, what and which vehicle", () => {
    const [valid] = declarationListing(listing).declarations;
    expect(valid).toMatchObject({
      uit: "XAXAXAXAXAXAXAXA1",
      uploadId: "0000000001",
      createdAtLocal: "2022-10-10T14:40:08",
      transportDate: "2022-10-10",
      operationType: "30",
      partner: { country: "RO", code: "8000000000", name: "SC TEST SRL" },
      vehicle: { tractor: "B00AAA", trailer1: undefined, trailer2: undefined },
      refused: false,
      messages: [],
    });
  });

  it("marks a refused declaration and keeps ANAF's reasons", () => {
    const [, refused] = declarationListing(listing).declarations;
    expect(refused?.refused).toBe(true);
    expect(refused?.uit).toBeUndefined();
    expect(refused?.messages[0]?.text).toContain("UIT");
  });

  it("surfaces ANAF's refusal instead of an empty list, and never echoes cui", () => {
    const out = declarationListing({
      Errors: [{ errorMessage: "Nu exista mesaje in ultimele 60 zile" }],
      dateResponse: "202203071316",
      ExecutionStatus: 1,
      trace_id: "t",
    });
    expect(out).toMatchObject({ count: 0, notice: "Nu exista mesaje in ultimele 60 zile" });
    expect(JSON.stringify(declarationListing(listing))).not.toContain("1000000000001");
  });
});
