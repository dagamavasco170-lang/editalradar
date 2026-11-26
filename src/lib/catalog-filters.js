export const isPreliminaryContest = (item) => /concurso listado\\s*·\\s*verificar/i.test(item?.status || "");

export const matchesContestCatalogFilters = (item, filters = {}) => {
  const text = [item.sigla, item.cargo, item.orgao, item.vinculo, item.atoOficial, item.nivel, item.area, item.estado, item.localidade, item.status].join(" ").toLocaleLowerCase("pt-BR");
  const query = (filters.query || "").toLocaleLowerCase("pt-BR");
  const status = (item.status || "").toLocaleLowerCase("pt-BR");
  const matchesSituation = filters.situacao === "Todas as situações"
    || (filters.situacao === "Pré-edital / anunciado" && /(autorizado|anunciado|pré-edital)/.test(status))
    || (filters.situacao === "Inscrições abertas" && /inscrições abertas/.test(status))
    || (filters.situacao === "Inscrições encerradas" && /inscrições encerradas/.test(status))
    || (filters.situacao === "Provas / resultados" && /(prova|resultado|provas realizadas)/.test(status));

  return text.includes(query)
    && (filters.nivel === "Todos os níveis" || item.nivel === filters.nivel)
    && (filters.esfera === "Todas as esferas" || (item.area || "Federal") === filters.esfera)
    && (filters.estado === "Todos os estados" || (item.estado || "Brasil") === filters.estado)
    && (filters.localidade === "Todas as cidades" || (item.localidade || "Brasil") === filters.localidade)
    && matchesSituation
    && (!filters.ocultarPreliminares || !isPreliminaryContest(item));
};
