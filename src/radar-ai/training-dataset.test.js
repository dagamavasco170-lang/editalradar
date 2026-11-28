import { describe, expect, it } from "vitest";
import { buildApprovedTrainingDataset, summarizeTrainingDataset, validateTrainingExample } from "./training-dataset.js";

const example = {
  id: "example-1",
  task: "tutor-explanation",
  input: { subject: "Direito Administrativo", topic: "Princípio da legalidade", prompt: "Explique o princípio." },
  target: "O princípio da legalidade exige que a Administração Pública atue conforme a lei e o ordenamento jurídico.",
  rubric: ["Explicação correta", "Linguagem clara", "Sem inventar fonte"],
  references: [{ title: "Constituição Federal", url: "https://www.planalto.gov.br/" }],
  reviewStatus: "approved",
  rightsStatus: "authorized",
};

describe("Radar AI training dataset", () => {
  it("accepts reviewed, referenced and rights-cleared examples", () => {
    expect(validateTrainingExample(example).valid).toBe(true);
  });
  it("rejects unreviewed, rights-uncleared and PII-containing examples", () => {
    const result = validateTrainingExample({ ...example, reviewStatus: "pending", rightsStatus: "unreviewed", target: "Contato: aluno@example.com. " + example.target });
    expect(result.errors).toContain("not-human-approved");
    expect(result.errors).toContain("rights-not-cleared");
    expect(result.errors).toContain("possible-personal-data");
  });
  it("builds a curated dataset and rejection list", () => {
    const result = buildApprovedTrainingDataset([example, { ...example, id: "bad", reviewStatus: "pending" }]);
    expect(result.counts).toEqual({ input: 2, approved: 1, rejected: 1 });
    expect(result.examples).toHaveLength(1);
  });
  it("summarizes examples by task", () => {
    expect(summarizeTrainingDataset([example])).toMatchObject({ "tutor-explanation": 1, "question-analysis": 0 });
  });
});
