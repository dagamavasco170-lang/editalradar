# Radar AI — Adapter + Adaptive Tutor Integration

This PR adds a licensed-question-bank adapter and the deterministic adaptive-tutor core.

## Pipeline
- Adapt local question tuples or published Supabase records into a normalized question contract.
- Supabase retrieval filters published records to cleared license classes; permission/Creative Commons rows must have an HTTPS proof URL, while public-domain rows may omit it.
- Question selection ranks available topics by recent learner accuracy, uncertainty, edital topic weights, and bank availability. Previously answered IDs are excluded.
- Answer validation returns correctness, stored explanation, correct option and source URL; an attempt records only question/topic/subject/correctness/time metadata.
- Rebuilds learner topic profile and selects the next recommendation after each response.

## Limits and safeguards
Deterministic core only: no LLM inference, no scraping, no database writes/migrations, no student free-text storage, no fine-tuning. The app should call this module only after its UI/server layer has verified the learner and loaded their authorized attempt history. Questions must already be cleared for display.
