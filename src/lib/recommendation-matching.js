const normalize = (value) => String(value ?? "")
  .toLocaleLowerCase("pt-BR")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

const AREA_KEYWORDS = {
  administrativa: ["administr", "assistente administrativo", "gestao publica", "recursos humanos", "protocolo"],
  policial: ["policia", "policial", "seguranca publica", "agente", "investigador", "delegado", "perito criminal"],
  tribunais: ["tribunal", "judici", "justica", "analista judiciario", "tecnico judiciario"],
  "fiscal e controle": ["auditor", "fiscal", "receita", "controle", "tribut", "cgu", "tcu"],
  bancaria: ["banco", "bancario", "bacen", "central", "caixa economica"],
  educacao: ["professor", "educacao", "pedagog", "docente", "magisterio"],
  saude: ["saude", "medico", "enferm", "enfermeiro", "odont", "farmac", "fisioter"],
  juridica: ["procurador", "jurid", "advog", "defensoria", "promotor"],
  tecnologia: ["tecnologia", "dados", "sistemas", "software", "desenvolvedor", "infraestrutura", "seguranca da informacao"]
};

const getAreaText = (item = {}) => normalize([
  item.cargo, item.orgao, item.especialidade, item.observacao, item.banca,
  ...(Array.isArray(item.areas) ? item.areas : [])
].filter(Boolean).join(" "));

const getEducationBand = (value) => {
  const text = normalize(value);
  if (!text || text.includes("nao informado") || text === "todos os niveis") return "unknown";
  if (text.includes("fundamental")) return "fundamental";
  if (text.includes("medio") || text.includes("tecnico")) return "medio";
  if (text.includes("superior")) return "superior";
  return "unknown";
};

const isNationalContest = (item = {}) =>
  normalize(item.estado) === "brasil" || normalize(item.localidade) === "brasil";

export const getRecommendationMatch = (item = {}, profile = {}) => {
  const area = normalize(profile.interest_area);
  const keywords = AREA_KEYWORDS[area] || [];
  const areaText = getAreaText(item);
  const areaMatches = keywords.length > 0 && keywords.some((word) => areaText.includes(normalize(word)));

  const profileEducation = getEducationBand(profile.education_level);
  const contestEducation = getEducationBand(item.nivel);
  const educationMatches = profileEducation !== "unknown" && (contestEducation === "unknown"
    || profileEducation === contestEducation
    || (profileEducation === "superior" && contestEducation === "medio"));

  const profileState = normalize(profile.state);
  const contestState = normalize(item.estado);
  const profileCity = normalize(profile.city);
  const contestCity = normalize(item.localidade);
  const national = isNationalContest(item);
  const stateMatches = Boolean(profileState) && (national || contestState === profileState);
  const cityMatches = Boolean(profileCity) && (national || contestCity === profileCity);
  const status = normalize(item.status);
  const active = /(inscricoes? abertas|inscricoes? em andamento|autorizad[oa]|pre edital|edital publicado|anunciad[oa]|comissao formada)/.test(status);

  const score = Math.round(
    (areaMatches ? 40 : 0)
    + (educationMatches ? 25 : 0)
    + (stateMatches ? 20 : 0)
    + (cityMatches ? 5 : 0)
    + (active ? 10 : 0)
  );

  return { score, areaMatches, educationMatches, stateMatches, cityMatches, national, active };
};

export const scoreRecommendation = (item, profile = {}) =>
  getRecommendationMatch(item, profile).score;

export const getRecommendationReasons = (item, profile = {}) => {
  const match = getRecommendationMatch(item, profile);
  return [
    match.areaMatches && "Área de interesse",
    match.educationMatches && "Escolaridade",
    match.national && "Abrangência nacional",
    !match.national && match.stateMatches && "Estado/local",
    !match.national && match.cityMatches && "Cidade/local",
    match.active && "Oportunidade ativa"
  ].filter(Boolean);
};
