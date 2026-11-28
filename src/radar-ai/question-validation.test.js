import { describe, expect, it } from "vitest";
import { validateGeneratedQuestion } from "./question-validation.js";

const validQuestion = {
  statement: "Sobre princípios da administração pública, assinale a alternativa correta.",
  subject: "Direito Administrativo",
  topic: "Princípios da Administração Pública",
  explanation: "A alternativa correta se relaciona ao princípio explicitamente fundamentado na fonte.",
  options: ["Alternativa A válida", "Alternativa B incorreta", "Alternativa C incorreta", "Alternativa D incorreta", "Alternativa E incorreta"],
  correctIndex: 0,
  difficulty: "medium",
  references: [{ title: "Constituição Federal", url: "https://www.planalto.gov.br/" }],
};

describe("Radar AI question validator", () => {
  it("accepts a structurally valid generated question", () => {
    expect(validateGeneratedQuestion(validQuestion)).toEqual({ valid: true, errors: [] });
  });

  it("rejects missing references", () => {
    expect(validateGeneratedQuestion({ ...validQuestion, references: [] }).valid).toBe(false);
  });

  it("rejects duplicate alternatives", () => {
    const duplicateOptions = [...validQuestion.options];
    duplicateOptions[4] = duplicateOptions[0];
    const result = validateGeneratedQuestion({ ...validQuestion, options: duplicateOptions });
    expect(result.errors).toContain("Options must be unique.");
  });

  it("rejects an out-of-range answer key", () => {
    const result = validateGeneratedQuestion({ ...validQuestion, correctIndex: 9 });
    expect(result.errors).toContain("correctIndex must be an integer between 0 and 4.");
  });
});
