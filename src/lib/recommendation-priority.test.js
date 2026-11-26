import { describe, expect, it } from "vitest";
import { classifyRecommendationPriority } from "./recommendation-priority.js";

describe("prioridade de concursos recomendados", () => {
  it("prioriza inscrição aberta quando há boa compatibilidade", () => {
    expect(classifyRecommendationPriority({ status: "Inscrições abertas" }, 85)).toBe("Alta prioridade");
  });
  it("diferencia inscrição aberta com baixa compatibilidade", () => {
    expect(classifyRecommendationPriority({ status: "Inscrições abertas" }, 40)).toBe("Inscrições abertas");
  });
  it("sinaliza concursos preliminares compatíveis para acompanhamento", () => {
    expect(classifyRecommendationPriority({ status: "Pré-edital" }, 80)).toBe("Acompanhar de perto");
  });
  it("não trata inscrições encerradas como oportunidade ativa", () => {
    expect(classifyRecommendationPriority({ status: "Inscrições encerradas" }, 95)).toBe("Etapa encerrada");
  });
  it("classifica compatibilidade quando status é neutro", () => {
    expect(classifyRecommendationPriority({}, 90)).toBe("Excelente compatibilidade");
    expect(classifyRecommendationPriority({}, 72)).toBe("Alta compatibilidade");
    expect(classifyRecommendationPriority({}, 50)).toBe("Compatibilidade moderada");
    expect(classifyRecommendationPriority({}, 20)).toBe("Baixa compatibilidade");
  });
});
