import { describe, expect, it } from "vitest";
import { evaluateAnswer, evaluateQuestion } from "./evaluation.js";

describe("Radar AI evaluation helpers", () => {
  it("checks answer references against retrieved sources", () => {
    const source = { title: "Fonte", url: "https://example.org/doc" };
    const result = evaluateAnswer({ text: "Resposta fundamentada.", references: [{ ...source }] }, [source]);
    expect(result.passed).toBe(true);
    expect(result.metrics.matchedReferenceCount).toBe(1);
  });
  it("flags references that do not match retrieval", () => {
    const result = evaluateAnswer({ text: "Texto", references: [{ url: "https://wrong.test" }] }, [{ url: "https://valid.test" }]);
    expect(result.issues).toContain("unmatched-references");
  });
  it("flags an answer without references when evidence was retrieved", () => {
    const result = evaluateAnswer({ text: "Resposta" }, [{ url: "https://valid.test" }]);
    expect(result.issues).toContain("missing-answer-references");
  });
  it("checks generated question structure and states limits", () => {
    const result = evaluateQuestion({ statement: "Enunciado", options: ["A","B","C","D","E"], correctIndex: 2, explanation: "Explicação", references: [{}] });
    expect(result.passed).toBe(true);
    expect(result.limitations[0]).toContain("factual accuracy");
  });
});
