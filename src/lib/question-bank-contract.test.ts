import { describe, expect, it } from "vitest";
import { isQuestionBankItem, normalizeQuestionBank, normalizeQuestionOptions } from "./question-bank-contract.ts";

const validQuestion = {
  id: "q-1", discipline: "Português", topic: "Crase", board: "FGV", difficulty: "Fácil",
  prompt: "Assinale a opção correta.", options: [["Certo", "certo"], ["Errado", "errado"]],
  answer: "certo", explanation: "Explicação objetiva.", origin: "authorial",
};

describe("question bank runtime contracts", () => {
  it("accepts well-formed question rows", () => {
    expect(isQuestionBankItem(validQuestion)).toBe(true);
  });

  it("rejects malformed question rows and empty prompts", () => {
    expect(isQuestionBankItem({ ...validQuestion, prompt: " " })).toBe(false);
    expect(isQuestionBankItem({ ...validQuestion, options: ["one"] })).toBe(false);
    expect(isQuestionBankItem(null)).toBe(false);
  });

  it("normalizes tuple and object options to label/value records", () => {
    expect(normalizeQuestionOptions([["Yes", "y"], { label: "No", value: "n" }])).toEqual([
      { label: "Yes", value: "y" }, { label: "No", value: "n" },
    ]);
  });

  it("filters invalid rows and normalizes options without mutating the input", () => {
    const rows = [validQuestion, { ...validQuestion, id: null }];
    const result = normalizeQuestionBank(rows);
    expect(result).toHaveLength(1);
    expect(result[0].options).toEqual([{ label: "Certo", value: "certo" }, { label: "Errado", value: "errado" }]);
    expect(rows[0].options).toEqual(validQuestion.options);
  });

  it("returns an empty list for non-array input", () => {
    expect(normalizeQuestionBank({ question: validQuestion })).toEqual([]);
  });
});
