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
