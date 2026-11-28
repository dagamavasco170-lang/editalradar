import { describe, expect, it } from "vitest";
import { classifyGeneratedReview, filterQuestionCandidates, isDuplicateQuestion, isTrustedPrivateStudySourceUrl, similarityScore, findPortugueseConcatenatedWords, hasMissingSpacesAfterPunctuation, validateQuestion } from "./validation.ts";

const source = "A administração pública direta e indireta de qualquer dos Poderes da União, dos Estados, do Distrito Federal e dos Municípios obedecerá aos princípios de legalidade, impessoalidade, moralidade, publicidade e eficiência.";
const question = {
  prompt: "Segundo o texto de referência, quais princípios devem orientar a administração pública?",
  options: [
    { id: "a", text: "Legalidade, impessoalidade, moralidade, publicidade e eficiência." },
    { id: "b", text: "Hierarquia, sigilo, pessoalidade, disciplina e eficiência." },
    { id: "c", text: "Oportunidade, conveniência, sigilo, hierarquia e economicidade." },
    { id: "d", text: "Autotutela, supremacia, continuidade, informalidade e controle." }
  ],
  answer: "a",
  explanation: "O trecho apresentado enumera expressamente os princípios da legalidade, impessoalidade, moralidade, publicidade e eficiência.",
  evidence_excerpt: "princípios de legalidade, impessoalidade, moralidade, publicidade e eficiência"
};

describe("Validação automática de questões", () => {
  it("aprova uma estrutura íntegra e evidência literal na fonte", () => {
    expect(validateQuestion(question, source)).toEqual({ valid: true, issues: [] });
  });
  it("identifica junções de palavras usando o léxico pt-BR e não divide palavra legítima", () => {
    const lexicon = new Set([
      "permaneceu", "durante", "dois", "dia", "sob", "guarda", "policial",
      "olheira", "acentuado", "muito", "local", "ermo", "homem", "nervoso",
      "roupa"
    ]);
    const fused = "permaneceudurantedoissobaguardadospoliciais olheirasacentuadase semuito";
    const detected = findPortugueseConcatenatedWords(fused, lexicon);
    expect(detected).toContain("permaneceudurantedoissobaguardadospoliciais");
    expect(detected).toContain("olheirasacentuadase");
    expect(detected).toContain("semuito");
    expect(findPortugueseConcatenatedWords(
      "permaneceu durante dois dias sob a guarda dos policiais",
      lexicon
    )).toEqual([]);
    expect(findPortugueseConcatenatedWords(
      "Donaudampfschifffahrselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft",
      lexicon
    )).toEqual([]);
    const morphologyLexicon = new Set(["examinador", "administrador", "professor", "criativo", "bondoso", "técnico", "bancário", "brasileiro"]);
    expect(findPortugueseConcatenatedWords(
      "A banca examinadora e a equipe administradora, com professoras, técnicas, bancárias e brasileiras.",
      morphologyLexicon
    )).toEqual([]);
  });

  it("detecta ausência de espaço após pontuação em enunciados e alternativas", () => {
    expect(hasMissingSpacesAfterPunctuation("Após a detenção,permaneceu em local ermo.")).toBe(true);
    expect(hasMissingSpacesAfterPunctuation("A frase terminou. O texto continua.")).toBe(false);
  });

  it("bloqueia questão com palavras concatenadas no enunciado ou nas alternativas", () => {
    const lexicon = new Set([
      "permaneceu", "durante", "dois", "dia", "sob", "guarda", "policial",
      "olheira", "acentuado", "muito", "local", "ermo", "homem", "nervoso",
      "roupa"
    ]);
    const invalid = {
      ...question,
      options: [
        { id: "a", text: "A alternativa possui texto extenso e contém semuito no trecho final." },
        ...question.options.slice(1)
      ]
    };
    const result = validateQuestion(invalid, source, lexicon);
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toContain("Possíveis palavras concatenadas");
  });

  it("reprova gabarito que não existe entre as alternativas", () => {
    expect(validateQuestion({ ...question, answer: "e" }, source).valid).toBe(false);
  });
  it("reprova alternativas repetidas ou ausentes", () => {
    const invalid = { ...question, options: [question.options[0], question.options[0], question.options[2], question.options[3]] };
    expect(validateQuestion(invalid, source).valid).toBe(false);
  });
  it("reprova evidência que não consta literalmente do texto", () => {
    expect(validateQuestion({ ...question, evidence_excerpt: "princípio da supremacia absoluta" }, source).valid).toBe(false);
  });
  it("aceita apenas fontes privadas com reutilização explicitamente permitida", () => {
    expect(isTrustedPrivateStudySourceUrl("https://pt.wikibooks.org/wiki/Portugu%C3%AAs")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://pt.wikipedia.org/wiki/Matem%C3%A1tica")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://pt.wikiversity.org/wiki/Faculdade:Matem%C3%A1tica")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://pt.wiktionary.org/wiki/gram%C3%A1tica")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://www.politize.com.br/trilhas/politicas-publicas/")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://developer.mozilla.org/pt-BR/docs/Web/HTML")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://docs.python.org/pt-br/3/tutorial/index.html")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://www.postgresql.org/docs/current/tutorial.html")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://doc.rust-lang.org/book/")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://docs.github.com/pt/get-started")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://kubernetes.io/docs/concepts/overview/")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://docs.docker.com/get-started/")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://wikieducator.org/WikiEducator:About")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://pt.wikisource.org/wiki/O_Corti%C3%A7o/I")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://pt.wikisource.org/wiki/Dom_Casmurro/CXXI")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://pt.wikisource.org/wiki/Obra_aleatoria")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("https://www.gapminder.org/teaching/materials/")).toBe(true);
    expect(isTrustedPrivateStudySourceUrl("https://www.gapminder.org/data/")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("https://escolhalivre.org.br/en/about/")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("https://www.gov.br/concursos")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("https://www2.camara.leg.br/atividade-legislativa")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("https://brasilescola.uol.com.br/gramatica")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("https://www.todamateria.com.br/materias/")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("https://www.jusbrasil.com.br/artigos/")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("https://www.postgresql.org/about/licence/")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("https://kubernetes.io/")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("https://evil.developer.mozilla.org/pt-BR/docs/Web/HTML")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("https://pt.wikibooks.org.falso.example.com/")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("http://pt.wikibooks.org/")).toBe(false);
    expect(isTrustedPrivateStudySourceUrl("https://usuario:senha@pt.wikipedia.org/")).toBe(false);
  });
  it("detecta enunciados praticamente duplicados", () => {
    const original = "Segundo o texto de referência, quais princípios devem orientar a administração pública?";
    const duplicate = "Quais princípios devem orientar a administração pública segundo o texto de referência?";
    expect(similarityScore(original, duplicate)).toBeGreaterThan(0.82);
    expect(isDuplicateQuestion(duplicate, [original])).toBe(true);
  });
  it("não marca perguntas de assuntos diferentes como duplicadas", () => {
    expect(isDuplicateQuestion("Como calcular juros simples em um capital inicial?", ["Quais princípios orientam a administração pública?"])).toBe(false);
  });

  it("tenta repor apenas questões inválidas ou duplicadas sem enfraquecer a validação", () => {
    const duplicate = { ...question };
    const invalid = { ...question, prompt: "Considerando o trecho, assinale a alternativa adequada sobre os princípios administrativos?", evidence_excerpt: "trecho que não existe no material de referência" };
    const filtered = filterQuestionCandidates([question, duplicate, invalid], source, []);
    expect(filtered.validCandidates).toHaveLength(1);
    expect(filtered.issues).toHaveLength(2);
    expect(filtered.issues.join(" ")).toMatch(/repetido|duplicada/);
    expect(filtered.issues.join(" ")).toContain("evidência indicada não aparece literalmente");
  });

  it("envia questões limítrofes para revisão administrativa sem publicá-las automaticamente", () => {
    expect(classifyGeneratedReview({
      approved: true, score: 96, factualSupport: true, singleCorrectAnswer: true,
      explanationConsistent: true, issues: []
    })).toBe("auto_approved");
    expect(classifyGeneratedReview({
      approved: false, score: 86, factualSupport: true, singleCorrectAnswer: true,
      explanationConsistent: true, issues: ["Distrator precisa de avaliação"]
    })).toBe("manual_review");
    expect(classifyGeneratedReview({
      approved: true, score: 98, factualSupport: false, singleCorrectAnswer: true,
      explanationConsistent: true, issues: []
    })).toBe("rejected");
  });

});
