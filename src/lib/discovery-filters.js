const normalizeText = value => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

export function classifyDiscoveryKind(item = {}) {
  return item.discovery_type === "web_search_lead" ? "secondary" : "official";
}

export function classifyDiscoveryTopic(item = {}) {
  const text = normalizeText([item.title, item.context, item.candidate_url].join(" "));
  if (/\b(retificacao|retificacoes|errata|aditivo|alteracao do edital|cronograma retificado)\b/.test(text)) return "retification";
  if (/\b(resultado final|homologacao|convocacao|nomeacao|classificacao final|gabarito definitivo)\b/.test(text)) return "result";
  if (/\b(pre edital|pre-edital|autorizacao|comissao formada|banca definida|edital previsto)\b/.test(text)) return "pre_notice";
  return "general";
}

const UNRELATED_ADMINISTRATIVE_TOPIC = /\b(transacao tributaria|atos? declaratorios? executivos?|notificacoes? e intimacoes?|processo administrativo de responsabilizacao|licitacao|ouvidoria|transparencia|consulta fiscal|leilao|procuracoes?|pregao|contratos? administrativos?)\b/;

export function scoreDiscoveryPriority(item = {}, now = Date.now()) {
  const title = normalizeText(item.title);
  const context = normalizeText(item.context);
  const urlValue = String(item.candidate_url || "");
  let path = "";
  try {
    const parsed = new URL(urlValue);
    path = parsed.pathname.toLowerCase();
  } catch {
    path = urlValue.toLowerCase();
  }
  const text = [title, context, path].join(" ");
  let score = item.discovery_type === "new_link" ? 34
    : item.discovery_type === "page_change" ? 27
      : item.discovery_type === "web_search_lead" ? 5 : 0;

  if (/\b(retificacao|retificacoes|errata|aditivo|alteracao do edital|cronograma retificado)\b/.test(text)) score += 28;
  if (/\b(resultado final|homologacao|convocacao|nomeacao|classificacao final)\b/.test(text)) score += 18;
  if (/\b(pre edital|pre-edital|autorizacao|comissao formada|banca definida|edital previsto)\b/.test(text)) score += 6;
  if (/\bedital\s+(?:n[º°.]?\s*)?\d{1,4}(?:[./-]\d{2,4})?\b/.test(title)) score += 24;
  else if (/\bedital\b/.test(text)) score += 10;
  if (/\b(concurso publico|processo seletivo|selecao publica)\b/.test(text)) score += 14;
  if (/\b(vagas?|cargos?|funcoes?|inscricoes abertas|prazo de inscricao)\b/.test(text)) score += 10;
  if (/\.pdf(?:$|[?#])/.test(urlValue.toLowerCase())) score += 14;
  if (/\/concursos?\/[^/]+/i.test(path)) score += 8;
  if (/^\/(?:concursos?|editais?|selecoes?|processos-seletivos?)\/?$/i.test(path)) score -= 25;
  if (UNRELATED_ADMINISTRATIVE_TOPIC.test(text)) score -= 55;
  if (/^(?:gov\.br|mais|inicio|home|editais?|processos seletivos?)$/.test(title.trim())) score -= 16;

  const detectedAt = Date.parse(item.detected_at || "");
  if (Number.isFinite(detectedAt) && detectedAt <= now) {
    const ageHours = (now - detectedAt) / (60 * 60 * 1000);
    score += Math.min(12, Math.floor(ageHours / 18));
  }

  // A notícia externa pode ser relevante, mas continua sendo apenas uma pista:
  // sua prioridade nunca ultrapassa a faixa média até a validação do domínio oficial.
  if (item.discovery_type === "web_search_lead") score = Math.min(score, 54);
  return score;
}

export function classifyDiscoveryPriority(item = {}, now = Date.now()) {
  const score = scoreDiscoveryPriority(item, now);
  return score >= 65 ? "high" : score >= 28 ? "medium" : "low";
}

export function discoveryPriorityLabel(priority) {
  return ({ high: "Alta prioridade", medium: "Prioridade média", low: "Baixa prioridade" })[priority] || "Prioridade média";
}

export function sortDiscoveriesByPriority(items = [], now = Date.now()) {
  const statusRank = { pending: 0, published: 1, dismissed: 2 };
  return (Array.isArray(items) ? items : [])
    .filter(item => item && typeof item === "object")
    .slice()
    .sort((a, b) => {
      const statusDifference = (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3);
      if (statusDifference) return statusDifference;
      const scoreDifference = scoreDiscoveryPriority(b, now) - scoreDiscoveryPriority(a, now);
      if (scoreDifference) return scoreDifference;
      const dateA = Date.parse(a.detected_at || "") || 0;
      const dateB = Date.parse(b.detected_at || "") || 0;
      if (dateA !== dateB) return dateA - dateB;
      return String(a.id ?? "").localeCompare(String(b.id ?? ""), "pt-BR", { numeric: true });
    });
}

export function discoveryKindLabel(kind) {
  return ({ secondary: "Pista externa", official: "Fonte oficial" })[kind] || "Fonte oficial";
}

export function discoveryTopicLabel(topic) {
  return ({
    retification: "Retificação / errata",
    result: "Resultado / convocação",
    pre_notice: "Pré-edital / autorização",
    general: "Publicação / atualização"
  })[topic] || "Publicação / atualização";
}

export function discoveryStatusLabel(status) {
  return ({ pending: "Pendente", published: "Publicada", dismissed: "Descartada" })[status] || "Status desconhecido";
}

export function filterDiscoveries(items = [], filters = {}, now = Date.now()) {
  const query = normalizeText(filters.query).trim();
  const kind = filters.kind || "all";
  const topic = filters.topic || "all";
  const priority = filters.priority || "all";
  const status = filters.status || "pending";
  const period = filters.period || "all";
  const windowMs = ({ "24h": 24, "7d": 24 * 7, "30d": 24 * 30 })[period] * 60 * 60 * 1000;

  return (Array.isArray(items) ? items : []).filter(item => {
    if (!item || typeof item !== "object") return false;
    if (status !== "all" && item.status !== status) return false;
    if (kind !== "all" && classifyDiscoveryKind(item) !== kind) return false;
    if (topic !== "all" && classifyDiscoveryTopic(item) !== topic) return false;
    if (priority !== "all" && classifyDiscoveryPriority(item, now) !== priority) return false;
    if (query) {
      const haystack = normalizeText([item.title, item.context, item.candidate_url, item.source_url].join(" "));
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
