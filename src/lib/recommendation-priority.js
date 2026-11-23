export const classifyRecommendationPriority = (item = {}, score = 0) => {
  const status = String(item.status || "").toLocaleLowerCase("pt-BR");
  if (/inscri.{0,18}abert|edital publicado/.test(status)) {
    return score >= 70 ? "Alta prioridade" : "Inscrições abertas";
  }
  if (/pré.?edital|autorizad|anunciad|comissão formada|previst/.test(status)) {
    return score >= 70 ? "Acompanhar de perto" : "Acompanhar";
  }
  if (/encerrad|finalizad|homologad|cancelad|suspens/.test(status)) return "Etapa encerrada";
  if (score >= 85) return "Excelente compatibilidade";
  if (score >= 70) return "Alta compatibilidade";
  if (score >= 45) return "Compatibilidade moderada";
  return "Baixa compatibilidade";
};
