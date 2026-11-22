import { describe, expect, it } from "vitest";
import { isDuplicateQuestion, isTrustedPrivateStudySourceUrl, similarityScore, validateQuestion } from "./validation.ts";

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
});
