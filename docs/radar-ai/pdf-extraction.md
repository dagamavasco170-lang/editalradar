# Radar AI — PDF text extraction foundation

This module extracts selectable text from a **local PDF file** and returns page-numbered text records. It does not fetch URLs, run OCR, publish exam questions, or bypass source-rights review.

## Requirements

The host must provide Poppler utilities: `pdfinfo` and `pdftotext`. The Node runtime is Node 22+.

## Limits

- File size: 25 MiB maximum.
- Page count: 300 maximum.
- Extraction output buffer: 15 MiB.
- Command timeouts are bounded.
- The input must be a regular file with a PDF signature.

## Usage

```js
import { extractKnowledgePdf } from "./pdf-extractor.js";
const result = extractKnowledgePdf("/tmp/authorized-material.pdf");
if (result.extracted) {
  // Register/verify source rights separately before ingesting returned page text.
  const text = result.pages.map(page => page.text).join("\n\n");
}
```

Image-only/scanned PDFs return a clear message. OCR is intentionally deferred to a separate, bounded step.
