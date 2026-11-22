export type QuestionOption = { id: string; text: string };

export type GeneratedQuestion = {
  prompt: string;
  options: QuestionOption[];
  answer: string;
  explanation: string;
  evidence_excerpt: string;
};

export type ValidationResult = { valid: boolean; issues: string[] };

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isTrustedOfficialUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host.includes("..")) return false;
    if (host === "planalto.gov.br" || host.endsWith(".planalto.gov.br")) return false;
    const officialRoots = ["gov.br", "jus.br", "leg.br", "mp.br", "mil.br", "def.br", "un.org", "ibge.gov.br"];
    const boards = [
      "cebraspe.org.br", "igeduc.selecao.net.br", "igeduc.org.br", "ibfc.org.br",
      "quadrix.org.br", "fundacaolasalle.org.br", "fgv.br", "concursosfcc.com.br",
      "vunesp.com.br", "institutoaocp.org.br"
    ];
    return officialRoots.some((domain) => host === domain || host.endsWith("." + domain))
      || boards.some((domain) => host === domain || host.endsWith("." + domain));
  } catch {
    return false;
  }
}

export function validateQuestion(question: unknown, sourceExcerpt: string): ValidationResult {
  const issues: string[] = [];
  if (!question || typeof question !== "object" || Array.isArray(question)) {
    return { valid: false, issues: ["A questão não é um objeto válido."] };
  }

  const item = question as Record<string, unknown>;
  const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
  const explanation = typeof item.explanation === "string" ? item.explanation.trim() : "";
  const evidence = typeof item.evidence_excerpt === "string" ? item.evidence_excerpt.trim() : "";
  const answer = typeof item.answer === "string" ? item.answer.trim().toLowerCase() : "";
  const options = Array.isArray(item.options) ? item.options as QuestionOption[] : [];

  if (prompt.length < 30 || prompt.length > 2500) issues.push("Enunciado muito curto ou longo.");
  if (explanation.length < 40 || explanation.length > 2000) issues.push("Justificativa ausente ou insuficiente.");
  if (options.length !== 4) issues.push("A questão precisa ter exatamente quatro alternativas.");
  const ids = options.map((option) => String(option?.id || "").toLowerCase());
  const texts = options.map((option) => normalizeText(option?.text));
  if (ids.join(",") !== "a,b,c,d") issues.push("As alternativas precisam usar identificadores A, B, C e D.");
  if (new Set(texts).size !== texts.length || texts.some((text) => text.length < 8)) {
    issues.push("Há alternativas vazias, curtas ou repetidas.");
  }
  if (!ids.includes(answer)) issues.push("O gabarito não corresponde a uma alternativa.");
  if (evidence.length < 25 || evidence.length > 400) {
    issues.push("A evidência textual está ausente ou fora do tamanho permitido.");
  } else {
    const normalizedSource = normalizeText(sourceExcerpt);
    const normalizedEvidence = normalizeText(evidence);
    if (!normalizedSource.includes(normalizedEvidence)) {
      issues.push("A evidência indicada não aparece literalmente no material de referência.");
    }
  }
  if (/(alternativa correta|resposta correta|opção correta|opcao correta|texto da alternativa)/i.test(prompt)) {
    issues.push("O enunciado contém texto genérico de preenchimento.");
  }

  return { valid: issues.length === 0, issues };
}

function meaningfulTokens(value: unknown): Set<string> {
  const stop = new Set([
    "para", "com", "uma", "umas", "uns", "dos", "das", "que", "por", "nos", "nas",
    "ser", "sua", "seu", "sobre", "qual", "quais", "quando", "como", "entre", "pela",
    "pelo", "este", "esta", "esse", "essa", "sao", "sendo", "deve", "podera", "pode",
    "segundo", "considerando", "assinale", "julgue", "correto", "incorreto"
  ]);
  return new Set(normalizeText(value).split(" ").filter((token) => token.length > 2 && !stop.has(token)));
}

export function similarityScore(left: unknown, right: unknown): number {
  const a = meaningfulTokens(left);
  const b = meaningfulTokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function isDuplicateQuestion(prompt: string, existingPrompts: string[], threshold = 0.82): boolean {
  return existingPrompts.some((existing) => similarityScore(prompt, existing) >= threshold);
}
