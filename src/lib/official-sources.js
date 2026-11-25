const OFFICIAL_SUFFIXES = [".gov.br", ".jus.br", ".leg.br", ".mp.br", ".mil.br", ".def.br"];
const APPROVED_PROVIDERS = [
  "cebraspe.org.br", "igeduc.selecao.net.br", "igeduc.org.br", "ibfc.org.br",
  "quadrix.org.br", "fundacaolasalle.org.br", "fgv.br", "concursosfcc.com.br",
  "vunesp.com.br", "institutoaocp.org.br", "cesgranrio.org.br"
];

const PRIVATE_STUDY_SOURCE_DOMAINS = [
  "politize.com.br",
  "pt.wikibooks.org",
  "pt.wikipedia.org",
  "pt.wikiversity.org",
  "pt.wiktionary.org",
  "developer.mozilla.org", "docs.python.org", "www.postgresql.org", "doc.rust-lang.org",
  "docs.github.com", "kubernetes.io", "docs.aws.amazon.com", "docs.docker.com", "wikieducator.org", "pt.wikisource.org", "www.gapminder.org"
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

function matchesDomain(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

export function isTrustedOfficialHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host || host.includes("..")) return false;
  return OFFICIAL_SUFFIXES.some(suffix => host.endsWith(suffix))
    || APPROVED_PROVIDERS.some(domain => matchesDomain(host, domain));
}

export function isTrustedOfficialUrl(value) {
  const url = parseHttpsUrl(value);
  return Boolean(url && isTrustedOfficialHostname(url.hostname));
}

export function isTrustedPrivateStudySourceHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host || host.includes("..")) return false;
  return PRIVATE_STUDY_SOURCE_DOMAINS.some(domain => matchesDomain(host, domain));
}

export function isTrustedPrivateStudySourceUrl(value) {
  const url = parseHttpsUrl(value);
  if (!url || !isTrustedPrivateStudySourceHostname(url.hostname)) return false;
  const host = url.hostname.toLowerCase();
  let path;
  try {
    path = decodeURIComponent(url.pathname).toLowerCase();
  } catch {
    return false;
  }
  if ((host === "www.postgresql.org" || host === "postgresql.org") && !path.startsWith("/docs/")) return false;
  if (host === "kubernetes.io" && !path.startsWith("/docs/")) return false;
  if (host === "developer.mozilla.org" && !path.includes("/docs/")) return false;
  if (host === "pt.wikisource.org" && !(path.startsWith("/wiki/o_cortiço/") || path.startsWith("/wiki/dom_casmurro/"))) return false;
  if (host === "www.gapminder.org" && path !== "/teaching/materials/") return false;
  return true;
}

export function officialSourceLabel(value) {
  if (isTrustedOfficialUrl(value)) return "Fonte oficial";
  return parseHttpsUrl(value) ? "Referência externa · confirme no órgão" : "Fonte não verificada";
}

export function privateStudySourceLabel(value) {
  if (isTrustedPrivateStudySourceUrl(value)) return "Fonte privada de estudo selecionada";
  return parseHttpsUrl(value) ? "Fonte privada externa não selecionada" : "Fonte não verificada";
}
