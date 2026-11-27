export const normalizeCatalogSearchText = (value) => String(value ?? "")
  .toLocaleLowerCase("pt-BR")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

const getContestSearchableFields = (item = {}) => {
  const remuneration = item.remuneracao ?? item.salario ?? item.salarioInicial ?? {};
  const documents = Array.isArray(item.documentos)
    ? item.documentos.flatMap((document) => typeof document === "string"
      ? [document]
      : [document?.title, document?.titulo, document?.label, document?.description, document?.descricao])
    : [];

  return [
    item.sigla,
    item.cargo,
    item.orgao,
    item.vinculo,
    item.atoOficial,
    item.nivel,
    item.area,
    item.estado,
    item.localidade,
    item.status,
    item.observacao,
    item.banca,
    item.especialidade,
    ...documents,
    ...(remuneration && typeof remuneration === "object" ? Object.values(remuneration) : [remuneration])
  ];
};

export const isPreliminaryContest = (item) => /concurso listado\s*·\s*verificar/i.test(item?.status || "");

export const matchesContestCatalogFilters = (item = {}, filters = {}) => {
  const text = normalizeCatalogSearchText(getContestSearchableFields(item).join(" "));
  const query = normalizeCatalogSearchText(filters.query);
  const status = normalizeCatalogSearchText(item.status);
  const situation = normalizeCatalogSearchText(filters.situacao);
  const matchesSituation = !situation || situation === "todas as situacoes"
    || (situation === "pre edital anunciado" && /(autorizado|anunciado|pre edital)/.test(status))
    || (situation === "inscricoes abertas" && /inscricoes? (?:abertas|em andamento)/.test(status))
    || (situation === "inscricoes encerradas" && /inscricoes? (?:encerradas|finalizadas)/.test(status))
    || (situation === "provas resultados" && /(prova|resultado|provas realizadas)/.test(status));

  return text.includes(query)
    && (filters.nivel === "Todos os níveis" || item.nivel === filters.nivel)
    && (filters.esfera === "Todas as esferas" || (item.area || "Federal") === filters.esfera)
    && (filters.estado === "Todos os estados" || (item.estado || "Brasil") === filters.estado)
    && (filters.localidade === "Todas as cidades" || (item.localidade || "Brasil") === filters.localidade)
    && matchesSituation
    && (!filters.ocultarPreliminares || !isPreliminaryContest(item));
};
