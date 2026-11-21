export function decodeHtmlEntities(value: string): string {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => {
      const point = Number(code);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&#x([\da-f]+);/gi, (_match, code) => {
      const point = Number.parseInt(code, 16);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    });
}

export function htmlToReadableText(html: string): string {
  const text = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/main|\/blockquote|\/pre)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeHtmlEntities(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractReadableSourceText(contentType: string, body: string): string {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("application/pdf") || type.includes("image/")) {
    throw new Error("Esta fonte é um PDF ou uma imagem, cujo texto não é extraído automaticamente nesta versão.");
  }
  if (type.includes("html") || type.includes("xhtml")) return htmlToReadableText(body);
  if (type.startsWith("text/") || type.includes("application/xml")) {
    return decodeHtmlEntities(String(body || "")).replace(/\s+/g, " ").trim();
  }
  throw new Error("Formato da fonte não suportado para extração automática. Use uma página HTML ou cole o trecho manualmente.");
}
