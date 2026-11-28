import { describe, expect, it, vi } from "vitest";
import { adaptQuestionRecord, adaptLocalQuestionBank, fetchLicensedQuestionBank } from "./question-bank-adapter.js";

const sample = { id: "q1", discipline: "Direito Administrativo", topic: "Legalidade", difficulty: "Intermediária", board: "Cebraspe", exam_name: "Teste", exam_year: 2026, prompt: "Enunciado suficientemente longo para ser usado como questão.", options: [["Certo", "certo"], ["Errado", "errado"]], answer: "certo", explanation: "Explicação demonstrativa com conteúdo mínimo.", source_url: "https://example.org", published: true, license_status: "permission_granted" };

describe("Radar AI question bank adapter", () => {
  it("adapts DB/local tuples into stable fields and correct answer index", () => {
    const result = adaptQuestionRecord(sample);
    expect(result.valid).toBe(true);
    expect(result.question.answerIndex).toBe(0);
    expect(result.question.options).toEqual(["Certo", "Errado"]);
    expect(result.question.subjectKey).toBe("direito-administrativo");
  });
  it("adapts alphabetic answer letters", () => {
    expect(adaptQuestionRecord({ ...sample, answer: "b" }).question.answerIndex).toBe(1);
  });
  it("rejects records missing answer mapping or with invalid source protocol", () => {
    expect(adaptQuestionRecord({ ...sample, answer: "not an option", source_url: "http://example.com" }).errors).toEqual(expect.arrayContaining(["answer-not-mappable", "source-url-must-be-https"]));
  });
  it("normalizes a mixed local bank while reporting rejected records", () => {
    const result = adaptLocalQuestionBank([sample, { id: "bad" }]);
    expect(result.total).toBe(1);
    expect(result.rejected).toHaveLength(1);
  });
  it("queries published licensed records and applies filters", async () => {
    const rows = [{ ...sample, options: ["Certo", "Errado"] }];
    const chain = {};
    for (const method of ["select", "eq", "in", "order", "range"]) chain[method] = vi.fn(() => chain);
    chain.then = (resolve) => Promise.resolve({ data: rows, error: null }).then(resolve);
    const supabase = { from: vi.fn(() => chain) };
    const result = await fetchLicensedQuestionBank(supabase, { limit: 10, discipline: "Direito Administrativo" });
    expect(supabase.from).toHaveBeenCalledWith("study_questions");
    expect(chain.eq).toHaveBeenCalledWith("published", true);
    expect(chain.in).toHaveBeenCalledWith("license_status", ["permission_granted", "public_domain", "cc_by", "cc_by_sa"]);
    expect(result.questions).toHaveLength(1);
  });
});
