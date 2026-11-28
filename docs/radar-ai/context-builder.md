# Context Builder

Builds a limited, source-attributed retrieval context from knowledge chunks for a future model adapter. It performs no model inference. It reports whether retrieval found evidence and includes a limitation when no evidence is available. Context size and number of sources are bounded to avoid oversized prompts.