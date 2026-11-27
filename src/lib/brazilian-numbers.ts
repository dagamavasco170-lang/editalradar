const NUMBER_TOKEN = /[+-]?\d[\d.,]*/g;

type NumberSelection = "first" | "highest" | "lowest";

interface ParseBrazilianNumberOptions {
  pick?: NumberSelection;
}

function parseNumberToken(token: string): number | null {
  const cleaned = String(token || "").replace(/[.,]+$/, "");
  if (!cleaned) return null;

  const sign = cleaned.startsWith("-") ? -1 : 1;
  const unsigned = cleaned.replace(/^[+-]/, "");
  if (!unsigned) return null;

  const lastDot = unsigned.lastIndexOf(".");
  const lastComma = unsigned.lastIndexOf(",");
  const hasDot = lastDot >= 0;
  const hasComma = lastComma >= 0;
  let integerPart = unsigned;
  let fractionPart = "";

  if (hasDot && hasComma) {
    const decimalIndex = Math.max(lastDot, lastComma);
    integerPart = unsigned.slice(0, decimalIndex).replace(/[.,]/g, "");
    fractionPart = unsigned.slice(decimalIndex + 1).replace(/[.,]/g, "");
  } else if (hasComma) {
    integerPart = unsigned.slice(0, lastComma).replace(/[.,]/g, "");
    fractionPart = unsigned.slice(lastComma + 1).replace(/[.,]/g, "");
  } else if (hasDot) {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(unsigned)) {
      integerPart = unsigned.replace(/\./g, "");
    } else {
      integerPart = unsigned.slice(0, lastDot).replace(/\./g, "");
      fractionPart = unsigned.slice(lastDot + 1).replace(/\./g, "");
    }
  }

  const normalized = (integerPart || "0") + (fractionPart ? "." + fractionPart : "");
  const parsed = Number(normalized) * sign;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Interpreta números no padrão brasileiro e aceita valores monetários em faixa.
 * Para faixas salariais, pick="highest" considera o maior valor anunciado.
 */
export function parseBrazilianNumber(
  value: unknown,
  { pick = "first" }: ParseBrazilianNumberOptions = {}
): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;

  const text = value.trim();
  const matches = [...text.matchAll(NUMBER_TOKEN)];
  const values = matches.map((match) => {
    const parsed = parseNumberToken(match[0]);
    if (parsed == null) return null;

    const suffix = text.slice((match.index ?? 0) + match[0].length)
      .match(/^\s*(milh(?:ão|ões)|mil|k)(?![a-zá-ú])/i)?.[1];
    if (!suffix) return parsed;
    const multiplier = suffix.toLocaleLowerCase("pt-BR").startsWith("milh") ? 1_000_000 : 1_000;
    return parsed * multiplier;
  }).filter((number): number is number => number !== null && Number.isFinite(number));

  if (!values.length) return null;
  if (pick === "highest") return Math.max(...values);
  if (pick === "lowest") return Math.min(...values);
  return values[0];
}
