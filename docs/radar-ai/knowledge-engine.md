# Radar AI — Knowledge Engine v0.1

This module defines a source-aware, provider-neutral knowledge ingestion and retrieval foundation.

## Source lifecycle
1. Register source with canonical URL, title, source type, subject/topic, license, attribution, retrieval date, and optional official flag.
2. Only ingest content with documented permission/license or public-domain/authorized status. Public accessibility is not automatically a reuse license.
3. Normalize and split text into chunks while preserving heading, page, and source metadata.
4. Validate required metadata and reject empty or malformed chunks.
5. Retrieve candidates using a transparent lexical score baseline; later replace/add embeddings and reranking behind the same interface.
6. Return chunk references and source metadata for answer grounding.

## v0.1 scope
No network fetcher, embeddings, vector DB, or model calls yet. This is a deterministic foundation that can be tested without external services. Keep retrieval scoped to a subject/topic when requested.

## Metadata schema
- id: stable chunk id
- sourceId, sourceTitle, sourceUrl, license, attribution
- subject, topic, section, page
- text, retrievedAt, official
