import { describe, expect, it } from "vitest";
import { isDuplicateQuestion, isTrustedOfficialUrl, similarityScore, validateQuestion } from "./validation.ts";

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
  it("aceita apenas editoras e plataformas privadas selecionadas", () => {
    expect(isTrustedOfficialUrl("https://brasilescola.uol.com.br/gramatica")).toBe(true);
    expect(isTrustedOfficialUrl("https://pt.khanacademy.org/math")).toBe(true);
    expect(isTrustedOfficialUrl("https://www.politize.com.br/trilhas/politicas-publicas/")).toBe(true);
    expect(isTrustedOfficialUrl("https://blog.grancursosonline.com.br/informatica-para-concursos-conceitos-basicos-para-prova/")).toBe(true);
    expect(isTrustedOfficialUrl("https://www.gov.br/concursos")).toBe(false);
    expect(isTrustedOfficialUrl("https://www2.camara.leg.br/atividade-legislativa")).toBe(false);
    expect(isTrustedOfficialUrl("https://educa.ibge.gov.br/")).toBe(false);
    expect(isTrustedOfficialUrl("https://brasilescola.uol.com.br.falso.example.com/")).toBe(false);
    expect(isTrustedOfficialUrl("http://brasilescola.uol.com.br/")).toBe(false);
    expect(isTrustedOfficialUrl("https://usuario:senha@todamateria.com.br/")).toBe(false);
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
