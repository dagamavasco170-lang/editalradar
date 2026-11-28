# Radar AI integration with question bank and tutor

This adapter reuses the existing study history in `question_progress.attempts`; it does not copy attempts into the generic training dataset or send student data to an external model.

- `toRadarLearningAttempts`: maps question attempts into topic events with discipline-qualified keys.
- `deriveTopicImportance`: estimates topic importance from current bank coverage, bounded to 0.75–2.
- `buildRadarLearningInsights`: invokes the deterministic learning profile over current question history.
- `selectQuestionWithLearningProfile`: ranks existing filtered questions using learning priority, then adaptive plan score.

The UI consumes the insights to show prioritized topics and choose the next adaptive practice question. This is an on-device/app-layer integration. Supabase private tables are not written by this adapter and migrations are not applied. Learner analytics remain estimates, not pass predictions.
