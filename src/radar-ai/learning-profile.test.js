import { describe, expect, it } from "vitest";
import { buildLearningProfile, validateLearningAttempt } from "./learning-profile.js";

const attempts = (topicKey, correctValues, base = "2026-11-01T12:00:00Z") => correctValues.map((correct, index) => ({
  topicKey, subject: "Direito Administrativo", correct, timestamp: new Date(Date.parse(base) + index * 86400000).toISOString(), errorType: correct ? undefined : "concept-confusion",
}));

describe("Radar AI learner profile", () => {
  it("validates attempts and rejects malformed data", () => {
    expect(validateLearningAttempt(attempts("tema", [true])[0]).valid).toBe(true);
    expect(validateLearningAttempt({}).valid).toBe(false);
  });
  it("marks sparse history as insufficient rather than concluding mastery", () => {
    const profile = buildLearningProfile(attempts("tema", [true, false]), { now: new Date("2026-11-04T12:00:00Z") });
    expect(profile.topics[0].mastery).toBe("insufficient-data");
    expect(profile.recommendations[0].action).toBe("diagnostic-practice");
  });
  it("detects weak topics and recommends targeted review", () => {
    const profile = buildLearningProfile(attempts("weak", [false, false, false, false, false, false]), { now: new Date("2026-11-10T12:00:00Z") });
    expect(profile.topics[0].mastery).toBe("needs-review");
    expect(profile.recommendations[0].action).toBe("targeted-review");
  });
  it("recognizes strong topics after enough evidence", () => {
    const profile = buildLearningProfile(attempts("strong", [true, true, true, true, true, true, true, true, true, true]), { now: new Date("2026-11-11T12:00:00Z") });
    expect(profile.topics[0].mastery).toBe("mastered");
    expect(profile.recommendations[0].action).toBe("maintenance-review");
  });
  it("uses topic importance to rank recommendations", () => {
    const profile = buildLearningProfile([...attempts("low", [false, false, false, false, false]), ...attempts("high", [false, false, false, false, false])], { now: new Date("2026-11-12T12:00:00Z"), topicImportance: { high: 2 } });
    expect(profile.recommendations[0].topicKey).toBe("high");
  });
});
