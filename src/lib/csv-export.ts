/**
 * Escapa uma célula CSV e neutraliza prefixos que planilhas podem interpretar
 * como fórmulas. Valores ficam entre aspas e aspas internas são duplicadas.
 */
export function escapeCsvCell(value: unknown): string {
  const raw = String(value ?? "");
  const formulaLike = /^[\u0000-\u0020\u00A0\uFEFF]*[=+\-@]/u.test(raw);
  const safe = formulaLike ? "'" + raw : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}

/**
 * Gera CSV separado por ponto e vírgula, com BOM UTF-8 e quebras CRLF.
 */
export function buildCsv(rows: unknown, delimiter = ";"): string {
  if (!Array.isArray(rows)) throw new TypeError("As linhas do CSV devem ser um array.");
  if (typeof delimiter !== "string" || delimiter.length !== 1 || /["\r\n]/.test(delimiter)) {
    throw new TypeError("O delimitador deve ser um único caractere válido.");
  }

  const body = (rows as unknown[][])
    .map((row) => (Array.isArray(row) ? row : []).map(escapeCsvCell).join(delimiter))
    .join("\r\n");
  return "\uFEFF" + body;
}
