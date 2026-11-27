import { describe, expect, it } from "vitest";
import { buildCsv, escapeCsvCell } from "./csv-export.ts";

describe("Exportação CSV", () => {
  it("gera arquivo UTF-8 com BOM e linhas CRLF", () => {
    const result = buildCsv([["Órgão", "Cargo"], ["Secretaria", "Técnico"]]);
    expect(result.charCodeAt(0)).toBe(0xFEFF);
    expect(result).toBe("\uFEFF\"Órgão\";\"Cargo\"\r\n\"Secretaria\";\"Técnico\"");
  });

  it("escapa aspas e mantém separadores dentro de células", () => {
    expect(escapeCsvCell("Cargo \"A\"; especial")).toBe("\"Cargo \"\"A\"\"; especial\"");
  });

  it.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@SUM(A1)", "\t=1+1", "\r\n=1+1"])(
    "neutraliza conteúdo que pode iniciar fórmula: %s",
    (value) => {
      expect(escapeCsvCell(value)).toBe("\"'" + value + "\"");
    }
  );

  it("preserva campos vazios e quebras de linha dentro de valores entre aspas", () => {
    expect(buildCsv([["", "linha 1\nlinha 2"]])).toBe("\uFEFF\"\";\"linha 1\nlinha 2\"");
  });

  it("rejeita delimitadores inválidos", () => {
    expect(() => buildCsv([], "\r")).toThrow(TypeError);
    expect(() => buildCsv({}, ";")).toThrow(TypeError);
  });
});
