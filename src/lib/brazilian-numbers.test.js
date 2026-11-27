import { describe, expect, it } from "vitest";
import { parseBrazilianNumber } from "./brazilian-numbers.ts";

describe("Leitura de números brasileiros", () => {
  it("interpreta valores monetários com separadores brasileiros", () => {
    expect(parseBrazilianNumber("R$ 2.354,67")).toBe(2354.67);
    expect(parseBrazilianNumber("R$ 35.877,28")).toBe(35877.28);
  });

  it("reconhece números inteiros com separador de milhar", () => {
    expect(parseBrazilianNumber("1.320 vagas")).toBe(1320);
    expect(parseBrazilianNumber("12.345")).toBe(12345);
  });

  it("preserva valores numéricos e decimais já normalizados", () => {
    expect(parseBrazilianNumber(5318.63)).toBe(5318.63);
    expect(parseBrazilianNumber("5320.5")).toBe(5320.5);
  });

  it("seleciona a maior remuneração em uma faixa por cargo", () => {
    const range = "R$ 5.617,92 (Soldado) a R$ 12.937,33 (Oficial)";
    expect(parseBrazilianNumber(range, { pick: "highest" })).toBe(12937.33);
    expect(parseBrazilianNumber(range)).toBe(5617.92);
  });

  it("converte abreviações de mil e milhão", () => {
    expect(parseBrazilianNumber("R$ 5,6 mil")).toBe(5600);
    expect(parseBrazilianNumber("R$ 1,2 milhão")).toBe(1200000);
  });

  it("retorna null para valores vazios, inválidos ou não numéricos", () => {
    expect(parseBrazilianNumber(null)).toBe(null);
    expect(parseBrazilianNumber("")).toBe(null);
    expect(parseBrazilianNumber("Remuneração não informada")).toBe(null);
    expect(parseBrazilianNumber(Number.NaN)).toBe(null);
  });
});
