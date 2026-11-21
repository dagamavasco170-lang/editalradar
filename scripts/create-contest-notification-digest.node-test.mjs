import test from "node:test";
import assert from "node:assert/strict";
import { buildContestDigest } from "./create-contest-notification-digest.mjs";

test("gera digest somente para concursos novos ou alterados", () => {
  const previous = [
    { id: 1, cargo: "Analista", orgao: "Órgão A", status: "Pré-edital", sourceUrl: "https://example.gov.br/a" },
    { id: 2, cargo: "Técnico", orgao: "Órgão B", status: "Pré-edital", sourceUrl: "https://example.gov.br/b" }
  ];
  const current = [
    previous[0],
    { ...previous[1], status: "Inscrições abertas" },
    { id: 3, cargo: "Auditor", orgao: "Órgão C", status: "Autorizado", sourceUrl: "https://example.gov.br/c" }
  ];
  const result = buildContestDigest(previous, current);
  assert.equal(result.updates.length, 2);
  assert.deepEqual(result.updates.map((item) => item.id), [2, 3]);
});

test("não gera atualizações quando o catálogo permanece igual", () => {
  const catalog = [{ id: 10, cargo: "Professor", orgao: "Município" }];
  assert.equal(buildContestDigest(catalog, catalog).updates.length, 0);
});

test("não inclui campos extras nem informações desnecessárias no e-mail", () => {
  const result = buildContestDigest([], [{
    id: 4, cargo: "Auditor", orgao: "Receita", status: "Autorizado", nivel: "Superior",
    estado: "Brasil", localidade: "Brasil", sourceUrl: "https://example.gov.br/a",
    observacao: "Texto interno que não deve ir no digest"
  }]);
  assert.deepEqual(Object.keys(result.updates[0]), [
    "id", "cargo", "orgao", "status", "nivel", "estado", "localidade", "sourceUrl"
  ]);
});
