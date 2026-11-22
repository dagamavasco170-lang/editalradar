const APPROVED_SOURCE_DOMAINS = [
  "brasilescola.uol.com.br",
  "mundoeducacao.uol.com.br",
  "todamateria.com.br",
  "todoestudo.com.br",
  "pt.khanacademy.org",
  "khanacademy.org",
  "somatematica.com.br",
  "soportugues.com.br",
  "infoescola.com",
  "politize.com.br",
  "direitonet.com.br",
  "jusbrasil.com.br",
  "jrconcursos.com.br",
  "blog.grancursosonline.com.br",
  "grancursosonline.com.br",
  "jcconcursos.com.br",
  "7fontesconcursos.com.br",
  "tecconcursos.com.br",
  "blog.qconcursos.com",
  "qconcursos.com",
  "tecmundo.com.br",
  "olhardigital.com.br",
  "guiadoestudante.abril.com.br",
  "novaescola.org.br",
  "cpdoc.fgv.br",
  "fgv.br",
  "contabeis.com.br",
  "manualdaquimica.com",
  "drauziovarella.uol.com.br",
  "minhavida.com.br",
  "educamaisbrasil.com.br",
  "educacao.uol.com.br",
  "mundoestranho.abril.com.br",
  "todospelaeducacao.org.br",
  "institutopeninsula.org.br",
  "fundacaolemann.org.br",
  "cursinhoparamedicina.com.br",
  "estrategiaconcursos.com.br",
  "blog.estrategiaconcursos.com.br",
  "novaconcursos.com.br",
  "concursosnobrasil.com",
  "blog.grupogen.com.br",
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
  // Only vetted private educational publishers and study platforms are accepted.
  return APPROVED_SOURCE_DOMAINS.some(domain => host === domain || host.endsWith("." + domain));
}

export function isTrustedOfficialUrl(value) {
  const url = parseHttpsUrl(value);
  return Boolean(url && isTrustedOfficialHostname(url.hostname));
}

export function officialSourceLabel(value) {
  if (isTrustedOfficialUrl(value)) return "Fonte de estudo selecionada";
  return parseHttpsUrl(value) ? "Fonte externa não selecionada" : "Fonte não verificada";
}