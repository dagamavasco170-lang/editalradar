const TRACKED_FIELDS = [
  ["cargo", "Cargo"],
  ["orgao", "Órgão"],
  ["sigla", "Sigla"],
  ["vagas", "Vagas"],
  ["nivel", "Escolaridade"],
  ["area", "Esfera"],
  ["estado", "Estado"],
  ["localidade", "Cidade / localidade"],
  ["status", "Situação"],
  ["atoOficial", "Ato oficial"],
  ["sourceUrl", "Link oficial"],
  ["observacao", "Observações"],
  ["vinculo", "Vínculo"]
];

const comparable = value => value == null ? "" : String(value).trim();
const displayValue = value => {
  const normalized = comparable(value);
  if (!normalized) return "Não informado";
  return normalized.length > 240 ? normalized.slice(0, 237) + "..." : normalized;
};

export function summarizeContestChanges(changes = []) {
  if (!Array.isArray(changes) || changes.length === 0) return "Atualização registrada";
  const describe = change => `${change.label || change.field || "Campo"}: ${change.from || "Não informado"} → ${change.to || "Não informado"}`;
  if (changes.length <= 2) return changes.map(describe).join(" · ");
  return `${describe(changes[0])} · ${describe(changes[1])} · +${changes.length - 2} outra(s) alteração(ões)`;
}

export function describeContestHistoryEntry(entry = {}) {
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  const legacyGeneric = /^\\d+ campo\\(s\\) alterado\\(s\\)$/.test(String(entry.summary || ""));
  if (entry.summary && !legacyGeneric) return entry.summary;
  return summarizeContestChanges(changes) || entry.summary || "Atualização registrada";
}

export function buildContestChangeHistory(previous = {}, next = {}, options = {}) {
  const history = Array.isArray(previous?.historicoAtualizacoes)
    ? previous.historicoAtualizacoes
    : Array.isArray(next?.historicoAtualizacoes) ? next.historicoAtualizacoes : [];
  const changes = TRACKED_FIELDS.flatMap(([field, label]) => {
    const before = comparable(previous?.[field]);
    const after = comparable(next?.[field]);
    if (before === after) return [];
    return [{
      field,
      label,
      from: displayValue(before),
      to: displayValue(after)
    }];
  });

  if (!changes.length) return history.slice(-50);
  const at = options.at || new Date().toISOString();
  const actor = String(options.actor || "Administrador").slice(0, 180);
  return [...history, {
    id: at + "-" + history.length,
    at,
    actor,
    summary: summarizeContestChanges(changes),
    changes
  }].slice(-50);
}

export function formatContestHistoryDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data não informada" : date.toLocaleString("pt-BR");
}
