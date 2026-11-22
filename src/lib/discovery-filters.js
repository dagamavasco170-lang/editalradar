const normalizeText = value => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

export function classifyDiscoveryKind(item = {}) {
  if (item.discovery_type === "web_search_lead") return "secondary";
  const text = normalizeText([item.title, item.context, item.candidate_url].join(" "));
  if (/\b(retificacao|retificacoes|errata|aditivo|alteracao do edital|cronograma retificado)\b/.test(text)) return "retification";
  if (/\b(resultado final|homologacao|convocacao|nomeacao|classificacao final|gabarito definitivo)\b/.test(text)) return "result";
  if (/\b(pre edital|pre-edital|autorizacao|comissao formada|banca definida|edital previsto)\b/.test(text)) return "pre_notice";
  return "official";
}

export function discoveryKindLabel(kind) {
  return ({
    secondary: "Pista externa",
    official: "Fonte oficial",
    retification: "Retificação / errata",
    result: "Resultado / convocação",
    pre_notice: "Pré-edital"
  })[kind] || "Fonte oficial";
}

export function discoveryStatusLabel(status) {
  return ({
    pending: "Pendente",
    published: "Publicada",
    dismissed: "Descartada"
  })[status] || "Status desconhecido";
}

export function filterDiscoveries(items = [], filters = {}, now = Date.now()) {
  const query = normalizeText(filters.query).trim();
  const kind = filters.kind || "all";
  const status = filters.status || "pending";
  const period = filters.period || "all";
  const windowMs = ({ "24h": 24, "7d": 24 * 7, "30d": 24 * 30 })[period] * 60 * 60 * 1000;

  return (Array.isArray(items) ? items : []).filter(item => {
    if (!item || typeof item !== "object") return false;
    if (status !== "all" && item.status !== status) return false;
    if (kind !== "all" && classifyDiscoveryKind(item) !== kind) return false;
    if (query) {
      const haystack = normalizeText([
        item.title, item.context, item.candidate_url, item.source_url
      ].join(" "));
      if (!haystack.includes(query)) return false;
    }
    if (windowMs) {
      const detectedAt = Date.parse(item.detected_at || "");
      if (!Number.isFinite(detectedAt) || detectedAt < now - windowMs || detectedAt > now + 5 * 60 * 1000) return false;
    }
    return true;
  });
}

export function countDiscoveriesByStatus(items = []) {
  const counts = { pending: 0, published: 0, dismissed: 0, total: 0 };
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    counts.total += 1;
    if (Object.hasOwn(counts, item.status) && item.status !== "total") counts[item.status] += 1;
  }
  return counts;
}
