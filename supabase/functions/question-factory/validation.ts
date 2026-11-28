export type QuestionOption = { id: string; text: string };

export type GeneratedQuestion = {
  prompt: string;
  options: QuestionOption[];
  answer: string;
  explanation: string;
  evidence_excerpt: string;
};

export type ValidationResult = { valid: boolean; issues: string[] };

export const PT_BR_DICTIONARY_SNAPSHOT = "93ba2a6f3b2f85262fba72df09d448c6bb2fa50a";
const PT_BR_DICTIONARY_URLS = [
  `https://raw.githubusercontent.com/fserb/pt-br/${PT_BR_DICTIONARY_SNAPSHOT}/lexico`,
  `https://raw.githubusercontent.com/fserb/pt-br/${PT_BR_DICTIONARY_SNAPSHOT}/conjuga%C3%A7%C3%B5es`,
  `https://raw.githubusercontent.com/fserb/pt-br/${PT_BR_DICTIONARY_SNAPSHOT}/listas/municipios-br`
];
let portugueseLexiconPromise: Promise<Set<string>> | null = null;
const PORTUGUESE_DOMAIN_WORDS = new Set([
    "custodiado", "custodiada", "custodiados", "custodiadas",
    "multiversão", "retrocompatibilidade", "autoidentificação", "odontolegal",
    "autolesão", "cacheamento", "quiritariedade", "service"
  ]);
const PORTUGUESE_SHORT_JOIN_WORDS = new Set([
  "a", "à", "o", "e", "as", "os", "de", "do", "da", "dos", "das", "em", "no", "na",
  "nos", "nas", "ao", "aos", "se", "me", "te", "lhe", "lhes", "um", "uma", "uns", "umas",
  "que", "por", "para", "pelo", "pela", "pelos", "pelas", "com", "sem", "sob", "sobre",
  "entre", "após", "antes", "num", "numa", "nuns", "numas", "foi"
]);
const PORTUGUESE_FUNCTION_WORDS = new Set([
  "a", "à", "o", "e", "as", "os", "de", "do", "da", "dos", "das", "em", "no", "na",
  "nos", "nas", "ao", "aos", "se", "me", "te", "lhe", "lhes", "um", "uma", "uns", "umas",
  "que", "por", "para", "pelo", "pela", "pelos", "pelas", "com", "sem", "sob", "sobre",
  "entre", "após", "antes", "num", "numa", "nuns", "numas", "é", "são",
  "ser", "estar", "ter", "haver", "foi", "foram", "era", "eram", "seja", "sejam", "sido"
]);

export async function loadPortugueseLexicon(): Promise<Set<string>> {
  if (!portugueseLexiconPromise) {
    portugueseLexiconPromise = (async () => {
      const responses = await Promise.all(PT_BR_DICTIONARY_URLS.map((url) =>
        fetch(url, { headers: { Accept: "text/plain" } })
      ));
      for (const response of responses) {
        if (!response.ok) throw new Error("Não foi possível carregar o dicionário pt-BR (HTTP " + response.status + ").");
      }
      const contents = await Promise.all(responses.map(response => response.text()));
      const words = new Set<string>([...PORTUGUESE_FUNCTION_WORDS, ...PORTUGUESE_DOMAIN_WORDS]);
      for (const content of contents) {
        for (const rawWord of content.split(/\r?\n/)) {
          const word = rawWord.normalize("NFC").toLocaleLowerCase("pt-BR").trim();
          if (word) words.add(word);
        }
      }
      if (words.size < 250_000) throw new Error("O dicionário pt-BR carregado está incompleto; publicação automática bloqueada.");
      return words;
    })().catch((error) => {
      portugueseLexiconPromise = null;
      throw error;
    });
  }
  return portugueseLexiconPromise;
}

function portugueseDictionaryHasWord(value: string, lexicon: Set<string>): boolean {
  const word = value.normalize("NFC").toLocaleLowerCase("pt-BR");
  if (PORTUGUESE_FUNCTION_WORDS.has(word) || PORTUGUESE_DOMAIN_WORDS.has(word) || lexicon.has(word)) return true;

  const variants: string[] = [];
  // Flexões regulares só são aceitas se a forma-base constar do léxico.
  // Exemplos: examinadora -> examinador; brasileira -> brasileiro;
  // concomitantemente -> concomitante; longitudinalidades -> longitudinalidade.
  const genderVariants: Array<[string, string]> = [
    ["oras", "or"], ["ora", "or"],
    ["eiras", "eiro"], ["eira", "eiro"],
    ["ivas", "ivo"], ["iva", "ivo"],
    ["osas", "oso"], ["osa", "oso"],
    ["icas", "ico"], ["ica", "ico"],
    ["árias", "ário"], ["ária", "ário"]
  ];
  for (const [ending, replacement] of genderVariants) {
    if (word.endsWith(ending)) variants.push(word.slice(0, -ending.length) + replacement);
  }

  if (word.endsWith("mente")) {
    const root = word.slice(0, -5);
    variants.push(root);
    if (root.endsWith("ada")) variants.push(root.slice(0, -3) + "ado");
    if (root.endsWith("ida")) variants.push(root.slice(0, -3) + "ido");
    if (root.endsWith("osa")) variants.push(root.slice(0, -3) + "oso");
    if (root.endsWith("ica")) variants.push(root.slice(0, -3) + "ico");
  }
  if (word.endsWith("eia")) variants.push(word.slice(0, -3) + "eu");
  if (word.endsWith("a")) variants.push(word.slice(0, -1) + "o");
  if (word.endsWith("idades")) variants.push(word.slice(0, -1));
  if (word.endsWith("idade")) variants.push(word.slice(0, -5));
  if (word.endsWith("ções")) variants.push(word.slice(0, -3) + "ção");
  else if (word.endsWith("ões")) variants.push(word.slice(0, -3) + "ão");
  if (word.endsWith("ães")) variants.push(word.slice(0, -3) + "ão");
  if (word.endsWith("ens")) variants.push(word.slice(0, -3) + "em");
  if (word.endsWith("adas")) variants.push(word.slice(0, -4) + "ado");
  if (word.endsWith("idas")) variants.push(word.slice(0, -4) + "ido");
  if (word.endsWith("ada")) variants.push(word.slice(0, -3) + "ado");
  if (word.endsWith("ida")) variants.push(word.slice(0, -3) + "ido");
  if (word.endsWith("is")) variants.push(word.slice(0, -2) + "l");
  if (word.endsWith("es")) variants.push(word.slice(0, -2));
  if (word.endsWith("s")) variants.push(word.slice(0, -1));
  if (word.endsWith("as")) variants.push(word.slice(0, -2) + "ado", word.slice(0, -2) + "ido");
  if (word.endsWith("os")) variants.push(word.slice(0, -2) + "a");

  return variants.some(variant => lexicon.has(variant));
}

export function hasMissingSpacesAfterPunctuation(value: unknown): boolean {
  const text = String(value ?? "")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/`[^`]*`/gu, " ");
  return /[,;:!?](?=\p{L})/u.test(text) || /[.!?](?=\p{Lu}\p{Ll})/u.test(text);
}

export function findPortugueseConcatenatedWords(value: unknown, lexicon: Set<string>): string[] {
  const text = String(value ?? "")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/`[^`]*`/gu, " ");
  const words = text.match(/\p{L}+/gu) || [];
  return words.filter(original => {
    if (original.length < 6 || /[a-zà-ÿ][A-ZÀ-Þ]/u.test(original)) return false;
    const word = original.normalize("NFC").toLocaleLowerCase("pt-BR");
    if (portugueseDictionaryHasWord(word, lexicon)) return false;
    const paths = Array.from({ length: word.length + 1 }, () => [] as string[][]);
    paths[0] = [[]];
    for (let start = 0; start < word.length; start += 1) {
      if (!paths[start].length) continue;
      for (const path of paths[start]) {
        for (let end = start + 1; end <= Math.min(word.length, start + 24); end += 1) {
          const part = word.slice(start, end);
          if (part.length === 1 && !PORTUGUESE_FUNCTION_WORDS.has(part)) continue;
          if (!portugueseDictionaryHasWord(part, lexicon)) continue;
          if (paths[end].length < 80) paths[end].push([...path, part]);
        }
      }
    }
    return paths[word.length].some(parts => {
      const contentWords = parts.filter(part => !PORTUGUESE_FUNCTION_WORDS.has(part));
      const allContentWordsLookComplete = contentWords.every(part => part.length >= 4);
      const hasShortFunctionWord = parts.some(part => PORTUGUESE_SHORT_JOIN_WORDS.has(part));
      const hasBrokenWordBoundary = parts.some((part, index) =>
        index < parts.length - 1 && portugueseDictionaryHasWord(part + parts[index + 1], lexicon)
      );
      if (hasBrokenWordBoundary) return false;
      const longJoin = word.length >= 14 && allContentWordsLookComplete
        && contentWords.length >= 2 && hasShortFunctionWord;
      const twoWordJoin = word.length >= 13 && parts.length === 2
        && contentWords.length === 2 && contentWords.every(part => part.length >= 5);
      const shortJoin = word.length <= 13 && parts.length <= 3
        && contentWords.length === 1 && contentWords[0].length >= 4 && hasShortFunctionWord;
      return longJoin || twoWordJoin || shortJoin;
    });
  });
}

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isTrustedPrivateStudySourceUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const path = decodeURIComponent(url.pathname).toLowerCase();
    if (!host || host.includes("..")) return false;
    if (/(^|\.)(gov|gov\.br|jus\.br|leg\.br|mp\.br|mil\.br|def\.br)$/.test(host)) return false;
    if (host === "planalto.gov.br" || host.endsWith(".planalto.gov.br")) return false;
    const approvedHosts = ["www.politize.com.br","politize.com.br","pt.wikibooks.org","pt.wikipedia.org","pt.wikiversity.org","pt.wiktionary.org","developer.mozilla.org","docs.python.org","www.postgresql.org","doc.rust-lang.org","docs.github.com","kubernetes.io","docs.aws.amazon.com","docs.docker.com","wikieducator.org","pt.wikisource.org","www.gapminder.org"];
    if (!approvedHosts.includes(host)) return false;
    if (host === "www.postgresql.org" && !path.startsWith("/docs/")) return false;
    if (host === "kubernetes.io" && !path.startsWith("/docs/")) return false;
    if (host === "developer.mozilla.org" && !path.includes("/docs/")) return false;
    if (host === "pt.wikisource.org" && !(path.startsWith("/wiki/o_cortiço/") || path.startsWith("/wiki/dom_casmurro/"))) return false;
    if (host === "www.gapminder.org" && path !== "/teaching/materials/") return false;
    return true;
  } catch { return false; }
}

export function validateQuestion(question: unknown, sourceExcerpt: string, lexicon?: Set<string>): ValidationResult {
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
  if (hasMissingSpacesAfterPunctuation(prompt) || options.some(option => hasMissingSpacesAfterPunctuation(option?.text))) {
    issues.push("Espaço ausente após sinal de pontuação no enunciado ou em uma alternativa.");
  }
  if (lexicon) {
    const fusedPromptWords = findPortugueseConcatenatedWords(prompt, lexicon);
    const fusedOptionWords = options.flatMap(option => findPortugueseConcatenatedWords(option?.text, lexicon));
    if (fusedPromptWords.length || fusedOptionWords.length) {
      const examples = [...fusedPromptWords, ...fusedOptionWords].slice(0, 5).join(", ");
      issues.push("Possíveis palavras concatenadas, não reconhecidas como uma palavra no léxico pt-BR: " + examples + ". Conferir com a fonte e não corrigir por adivinhação.");
    }
  }

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


export type GeneratedReviewStatus = "auto_approved" | "manual_review" | "rejected";

export function filterQuestionCandidates(
  candidates: unknown,
  sourceExcerpt: string,
  existingPrompts: string[] = [],
  lexicon?: Set<string>
): { validCandidates: GeneratedQuestion[]; issues: string[] } {
  const validCandidates: GeneratedQuestion[] = [];
  const issues: string[] = [];
  const knownPrompts = [...existingPrompts];
  const rows = Array.isArray(candidates) ? candidates : [];

  for (let index = 0; index < rows.length; index += 1) {
    const candidate = rows[index] as GeneratedQuestion;
    const result = validateQuestion(candidate, sourceExcerpt, lexicon);
    if (!result.valid) {
      issues.push(`Questão ${index + 1}: ${result.issues.join(" ")}`);
      continue;
    }

    if (isDuplicateQuestion(candidate.prompt, knownPrompts)) {
      issues.push(`Questão ${index + 1}: enunciado repetido ou muito semelhante ao banco.`);
      continue;
    }

    if (isDuplicateQuestion(candidate.prompt, validCandidates.map((item) => item.prompt), 0.78)) {
      issues.push(`Questão ${index + 1}: duplicada dentro do lote gerado.`);
      continue;
    }

    validCandidates.push(candidate);
    knownPrompts.push(candidate.prompt);
  }

  return { validCandidates, issues };
}

export function classifyGeneratedReview(input: {
  approved: boolean;
  score: number;
  factualSupport: boolean;
  singleCorrectAnswer: boolean;
  explanationConsistent: boolean;
  issues: string[];
}): GeneratedReviewStatus {
  const objectiveChecksPassed = input.factualSupport
    && input.singleCorrectAnswer
    && input.explanationConsistent;

  if (input.approved && input.score >= 90 && objectiveChecksPassed && input.issues.length === 0) {
    return "auto_approved";
  }

  // Borderline questions remain unpublished and go to the administrator queue.
  // This preserves the automatic publication threshold while avoiding silent loss.
  if (input.score >= 80 && objectiveChecksPassed && input.issues.length <= 2) {
    return "manual_review";
  }

  return "rejected";
}
