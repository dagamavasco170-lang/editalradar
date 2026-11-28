import { describe, expect, it } from "vitest";
import { analyzeQuestionBank, normalizeQuestionRecord, recommendPracticeTopics, validateGeneratedQuestion, validateQuestionRecord } from "./question-intelligence.js";

const q = (id, topic = "Legalidade", board = "CEBRASPE") => ({ id, subject: "Direito Administrativo", topic, statement: "Considerando os princípios da administração pública, assinale a opção correta.", options: ["A opção correta", "Uma opção incorreta"], answerIndex: 0, board, difficulty: "medium", sourceUrl: "https://example.org/question", explanation: "A alternativa está correta porque aplica o princípio previsto na norma." });

describe("Radar AI question intelligence", () => {
  it("validates question structure and answer index", () => {
    expect(validateQuestionRecord(q("1")).valid).toBe(true);
    expect(validateQuestionRecord({ ...q("2"), answerIndex: 9 }).errors).toContain("invalid-answer-index");
  });
  it("normalizes taxonomy keys", () => {
    expect(normalizeQuestionRecord(q("1", "Princípio da Legalidade")).question.topicKey).toBe("principio-da-legalidade");
  });
  it("aggregates topic, subject, and exam board frequency", () => {
    const result = analyzeQuestionBank([q("1"), q("2"), q("3", "Atos Administrativos", "FCC"), q("3", "Duplicado")]);
    expect(result.total).toBe(3);
    expect(result.rejectedCount).toBe(1);
    expect(result.topics[0].count).toBe(2);
    expect(result.boards.map((board) => board.key)).toContain("cebraspe");
  });
  it("ranks learner topics only when questions exist", () => {
    const analysis = analyzeQuestionBank([q("1"), q("2")]);
    const profile = { topics: [{ topicKey: "legalidade", weightedAccuracy: 0.2, mastery: "needs-review" }, { topicKey: "not-in-bank", weightedAccuracy: 0, mastery: "needs-review" }] };
    expect(recommendPracticeTopics({ questionAnalysis: analysis, learningProfile: profile })).toHaveLength(1);
    expect(recommendPracticeTopics({ questionAnalysis: analysis, learningProfile: profile })[0].topicKey).toBe("legalidade");
  });
  it("validates generated questions with explanation, source, and unique options", () => {
    expect(validateGeneratedQuestion(q("gen")).valid).toBe(true);
    expect(validateGeneratedQuestion({ ...q("gen"), options: ["same", "same"], sourceUrl: "" }).errors).toContain("duplicate-options");
  });
});
