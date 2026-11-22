const OFFICIAL_SUFFIXES = [".gov.br", ".jus.br", ".leg.br", ".mp.br", ".mil.br", ".def.br"];

const APPROVED_PROVIDERS = [
  "cebraspe.org.br",
  "igeduc.selecao.net.br",
  "igeduc.org.br",
  "ibfc.org.br",
  "quadrix.org.br",
  "fundacaolasalle.org.br",
  "fgv.br",
  "concursosfcc.com.br",
  "vunesp.com.br",
  "institutoaocp.org.br"
];

export function parseHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function isTrustedOfficialHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host || host.includes("..")) return false;
  // Never accept the Planalto domain or any of its subdomains as an exam source.
  if (host === "planalto.gov.br" || host.endsWith(".planalto.gov.br")) return false;
  return OFFICIAL_SUFFIXES.some(suffix => host.endsWith(suffix))
    || host === "un.org" || host.endsWith(".un.org")
    || APPROVED_PROVIDERS.some(domain => host === domain || host.endsWith("." + domain));
}

export function isTrustedOfficialUrl(value) {
  const url = parseHttpsUrl(value);
  return Boolean(url && isTrustedOfficialHostname(url.hostname));
}

export function officialSourceLabel(value) {
  if (isTrustedOfficialUrl(value)) return "Fonte oficial";
  return parseHttpsUrl(value) ? "Referência externa · confirme no órgão" : "Fonte não verificada";
}