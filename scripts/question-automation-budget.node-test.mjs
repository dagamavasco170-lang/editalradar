import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyAutomationRunQuery } from "./question-automation-budget.mjs";

test("contabiliza todas as tentativas automáticas do dia, inclusive falhas", () => {
  const params = buildDailyAutomationRunQuery("2026-11-22T00:00:00.000Z", 8);
  assert.equal(params.get("select"), "id");
  assert.equal(params.get("started_at"), "gte.2026-11-22T00:00:00.000Z");
  assert.equal(params.get("trigger_mode"), "eq.scheduled");
  assert.equal(params.get("limit"), "8");
  assert.equal(params.has("status"), false);
});

test("usa o limite informado sem filtrar resultados pelo status", () => {
  const params = buildDailyAutomationRunQuery("2026-11-23T00:00:00.000Z", 3);
  assert.equal(params.get("limit"), "3");
  assert.equal(params.has("status"), false);
});

import { orderTopicsFairly } from "./question-automation-budget.mjs";

test("alterna disciplinas antes de repetir assuntos da mesma matéria", () => {
  const topics = [
    { id: "pt-1", discipline: "Português", last_run_at: null, created_at: "2026-01-01" },
    { id: "pt-2", discipline: "Português", last_run_at: null, created_at: "2026-01-02" },
    { id: "mat-1", discipline: "Matemática", last_run_at: null, created_at: "2026-01-01" },
    { id: "hist-1", discipline: "História", last_run_at: null, created_at: "2026-01-01" }
  ];
  const ordered = orderTopicsFairly(topics, [], new Date("2026-11-22T12:00:00.000Z"));
  assert.equal(new Set(ordered.slice(0, 3).map((topic) => topic.discipline)).size, 3);
  assert.notEqual(ordered[1].discipline, ordered[0].discipline);
});

test("prioriza disciplinas com menos tentativas nos últimos 14 dias", () => {
  const topics = [
    { id: "a", discipline: "A", last_run_at: null },
    { id: "b", discipline: "B", last_run_at: null },
    { id: "c", discipline: "C", last_run_at: null }
  ];
  const history = [
    { topic_id: "a", started_at: "2026-11-21T10:00:00.000Z" },
    { topic_id: "b", started_at: "2026-11-20T10:00:00.000Z" },
    { topic_id: "b", started_at: "2026-11-19T10:00:00.000Z" }
  ];
  const ordered = orderTopicsFairly(topics, history, new Date("2026-11-22T12:00:00.000Z"));
  assert.deepEqual(ordered.map((topic) => topic.discipline), ["C", "A", "B"]);
});

test("alterna a prioridade inicial em dias consecutivos quando há empate", () => {
  const topics = ["A", "B", "C"].map((discipline) => ({
    id: discipline, discipline, last_run_at: null
  }));
  const firstDay = orderTopicsFairly(topics, [], new Date("2026-11-22T12:00:00.000Z"));
  const nextDay = orderTopicsFairly(topics, [], new Date("2026-11-23T12:00:00.000Z"));
  assert.notEqual(firstDay[0].discipline, nextDay[0].discipline);
});
test("considera tentativas de assuntos fora da fila vencida para equilibrar disciplinas", () => {
  const due = [
    { id: "a-due", discipline: "A", last_run_at: null },
    { id: "b-due", discipline: "B", last_run_at: null }
  ];
  const catalog = [
    ...due,
    { id: "a-not-due", discipline: "A", last_run_at: "2026-11-21T10:00:00.000Z" }
  ];
  const history = [
    { topic_id: "a-not-due", started_at: "2026-11-21T10:00:00.000Z" },
    { topic_id: "a-not-due", started_at: "2026-11-20T10:00:00.000Z" },
    { topic_id: "b-due", started_at: "2026-11-20T10:00:00.000Z" }
  ];
  const ordered = orderTopicsFairly(due, history, new Date("2026-11-22T12:00:00.000Z"), catalog);
  assert.equal(ordered[0].discipline, "B");
  assert.equal(ordered[1].discipline, "A");
});
