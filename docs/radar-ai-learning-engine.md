# Radar AI — Learning and Training Engine (v0.1)

This layer turns exam-study events into transparent, testable learning recommendations. It is deterministic and does not train model weights.

## Training-example curation
A training example is accepted only when it has:
- A supported task and structured input.
- A target answer, rubric and HTTPS source references.
- Human review status `approved`.
- Explicit cleared rights status (authorized, permission_granted, public_domain, official_publication, cc_by or cc_by_sa).
- No obvious email, CPF or phone number in input/target.

`buildApprovedTrainingDataset` produces a safe curated set plus rejection reasons. Examples are generic teaching material, not student records. This is not an automatic fine-tuning/export step.

## Learner analytics
`buildLearningProfile` validates practice events, groups by topic and estimates weighted accuracy from the latest 20 attempts. Recency and topic importance influence study priority. Topics with fewer than five attempts are labeled `insufficient-data` and get diagnostic practice rather than a mastery judgment.

Actions: diagnostic-practice, targeted-review, mixed-practice, maintenance-review.

## Privacy and evaluation principles
- Do not put identifiers, email, phone or CPF in training examples.
- Learner events should be stored separately from generic training data and only for the study-personalization purpose.
- Never use profile scores as official grades, rankings or pass/fail predictions.
- Recommendations should expose their rationale and remain revisable.
- The generated dataset requires review and rights clearance; source access is not the same as reuse permission.

## Next steps
1. Persist practice events and topic aggregates in private, service-only tables.
2. Integrate with question answering and study-plan workflows.
3. Build benchmarks for answer correctness, citations, question quality and pedagogical usefulness.
4. Only consider fine-tuning after a curated dataset and benchmark justify it.
