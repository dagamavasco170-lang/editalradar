# Radar AI — Adaptive Tutor Core (v0.1)

This module is the integration point between a normalized question bank and deterministic learner analytics.

## Workflow
1. Build state from normalized questions and privacy-minimal attempts.
2. Select a question by topic weakness, evidence confidence, topic importance, and available question count. Previously attempted question IDs are excluded by default.
3. Validate an answer index.
4. Return feedback with the stored explanation, answer, and source URL.
5. Record an attempt without storing answer text and rebuild the topic profile.
6. Recommend a next topic/action based on question availability and recent accuracy.

## Contract
Question: `id, subject, topicKey, options (strings), answerIndex, explanation?, sourceUrl?
Attempt: `questionId, topicKey, subject, correct, timestamp, responseTimeMs?

This core is deterministic; it does not call an LLM, scrape sources, write to production, or train model weights. Feed it only questions already approved for display and normalized by the question-bank adapter.
