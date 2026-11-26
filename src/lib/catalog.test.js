import { describe, expect, it } from "vitest";
import { applyCatalogOverrides } from "./catalog";

describe("Sobrescritas do catálogo", () => {
  const base=[{id:1,cargo:"Auditor"},{id:2,cargo:"Técnico"}];
  it("atualiza ficha sem duplicar",()=>{
    expect(applyCatalogOverrides(base,[{id:1,data:{cargo:"Auditor fiscal"}}])).toEqual([{id:1,cargo:"Auditor fiscal"},{id:2,cargo:"Técnico"}]);
  });
  it("oculta ficha com exclusão lógica",()=>{
    expect(applyCatalogOverrides(base,[{id:2,data:base[1],deleted:true}])).toEqual([base[0]]);
  });
  it("acrescenta ficha nova com id do banco",()=>{
    expect(applyCatalogOverrides(base,[{id:1000001,data:{cargo:"Analista"}}])[2]).toEqual({id:1000001,cargo:"Analista"});
  });
});
