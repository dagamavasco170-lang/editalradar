# Radar AI — Integration with EditalRadar question bank

This adapter connects Radar AI to the current `study_questions` schema and the local question bank contract.

## Data source and filtering
- Reads `study_questions` through a caller-supplied Supabase client.
- Restricts retrieval to published records and the public/licensed statuses: `permission_granted`, `public_domain`, `cc_by`, `cc_by_sa`.
- Supports pagination (limit capped at 2,000) and optional discipline, board, and topic filters.
- It does not access private/admin-only unpublished rows.

## Canonical question record
Maps the schema fields `discipline`, `topic`, `prompt`, `options`, `answer`, `explanation`, `board`, `exam_name`, `exam_year`, `difficulty`, `origin`, `source_url`, `license_status` into stable Radar AI keys. Option tuples used by the local bank are flattened. Correct answer is normalized into an answer index.

## Scope and safety
- No migration, production write, scraping, or bulk content export.
- License gate mirrors the database's published-question policy. Source URLs are not interpreted as additional permission.
- Malformed records are reported separately and excluded from accepted output.
- This module can be passed to question-intelligence analysis in a later integration step; it does not assume PR #274 or #276 are merged.
