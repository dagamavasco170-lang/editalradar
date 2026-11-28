import { searchKnowledgeChunks } from "./knowledge-engine.js";

/**
 * Build a bounded, source-attributed context for a future model adapter.
 * This module does not call an LLM and must not be mistaken for semantic retrieval.
 */
export function buildTutorContext(chunks, question, filters = {}) {
  const limit = Math.max(1, Math.min(filters.limit ?? 5, 12));
  const maxContextChars = Math.max(1000, Math.min(filters.maxContextChars ?? 9000, 24000));
  const results = searchKnowledgeChunks(chunks, question, { ...filters, limit });
  let used = 0;
  const selected = [];
  for (const item of results) {
    const record = {
      id: item.chunk.id,
      title: item.chunk.sourceTitle,
      url: item.chunk.sourceUrl,
      license: item.chunk.license,
      attribution: item.chunk.attribution,
      subject: item.chunk.subject,
      topic: item.chunk.topic,
      text: item.chunk.text,
      score: item.score,
    };
    const cost = record.text.length;
    if (used + cost > maxContextChars) continue;
    used += cost;
    selected.push(record);
  }
  const contextText = selected.map((item, index) =>
    `[Fonte ${index + 1}] ${item.title} | ${item.url} | ${item.subject ?? "disciplina não informada"} / ${item.topic ?? "tema não informado"}\n${item.text}`
  ).join("\n\n");
  return {
    question: String(question ?? "").trim(),
    sources: selected,
    contextText,
    grounded: selected.length > 0,
    limitations: selected.length ? [] : ["Nenhum trecho relevante foi recuperado; a resposta não deve inventar fundamento ou fonte."],
  };
}
