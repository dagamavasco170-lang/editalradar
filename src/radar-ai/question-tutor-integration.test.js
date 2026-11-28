import { describe, expect, it } from "vitest";
import { buildRadarLearningInsights, deriveTopicImportance, selectQuestionWithLearningProfile, toRadarLearningAttempts } from "./question-tutor-integration.js";

const questions = [
  { id: "q1", discipline: "Português", topic: "Crase" },
  { id: "q2", discipline: "Português", topic: "Crase" },
  { id: "q3", discipline: "Português", topic: "Concordância" },
  { id: "q4", discipline: "Direito", topic: "Legalidade" },
];
const attempts = [
  { questionId: "q1", correct: false, at: "2026-11-01T12:00:00Z" },
  { questionId: "q2", correct: false, at: "2026-11-02T12:00:00Z" },
  { questionId: "q1", correct: true, at: "2026-11-03T12:00:00Z" },
];

describe("Radar AI question/tutor integration", () => {
  it("converts question attempts into topic events with stable keys", () => {
    const converted = toRadarLearningAttempts({ attempts, questions });
    expect(converted).toHaveLength(3);
    expect(converted[0]).toMatchObject({ topicKey: "Português::Crase", subject: "Português", correct: false });
    expect(toRadarLearningAttempts({ attempts: [...attempts, { questionId: "missing", correct: false, at: "2026-11-04T12:00:00Z" }], questions })).toHaveLength(3);
  });
  it("ranks topics by frequency with bounded importance", () => {
    const importance = deriveTopicImportance(questions);
    expect(importance["Português::Crase"]).toBeGreaterThan(importance["Português::Concordância"]);
    expect(Object.values(importance).every(value => value >= 0.75 && value <= 2)).toBe(true);
  });
  it("produces learning profile from bank attempt history", () => {
    const profile = buildRadarLearningInsights({ attempts, questions, now: new Date("2026-11-05T12:00:00Z") });
    expect(profile.topics.find(topic => topic.topicKey === "Português::Crase")).toMatchObject({ totalAttempts: 3, mastery: "insufficient-data" });
    expect(profile.recommendations[0].topicKey).toBe("Português::Crase");
  });
  it("selects the next filtered question from the most prioritized learning topic", () => {
    const profile = { recommendations: [
      { topicKey: "Direito::Legalidade", priority: 1.9 },
      { topicKey: "Português::Crase", priority: 0.9 },
    ] };
    const plan = [{ id: "q2", score: 50 }, { id: "q4", score: 40 }, { id: "q3", score: 60 }];
    expect(selectQuestionWithLearningProfile({ currentQuestionId: "q1", plan, filteredQuestions: questions, learningProfile: profile })).toBe("q4");
  });
});
