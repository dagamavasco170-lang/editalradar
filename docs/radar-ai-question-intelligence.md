# Radar AI — Question Intelligence (v0.1)

Deterministic analysis for structured question records. This module does not scrape, import, or train on question content.

## Functions
- `validateQuestionRecord`: checks ID, subject, topic, statement, options, answer index, optional difficulty and HTTPS source.
- `normalizeQuestionRecord`: canonicalizes subject/topic/bank keys and validates records.
- `analyzeQuestionBank`: rejects malformed/duplicate records and summarizes question counts, subject/topic distribution, difficulty and exam-board distribution.
- `recommendPracticeTopics`: combines the learner profile from the learning engine with available topic counts and explicit edital weights. Topics with no available questions are omitted.
- `validateGeneratedQuestion`: applies structure, explanation, source-reference and duplicate-option checks before generated questions are used.

## Limitations and guardrails
- Frequency statistics describe only the dataset supplied by the caller; they are not claims about all exams or future exam trends.
- No external question ingestion or scraping is performed.
- Source URLs are required for question records; source access does not imply reproduction rights.
- Analytics are deterministic and transparent; no model-weight training occurs.
- Integration with UI, storage, retrieval, and learning engine is a later stage.
