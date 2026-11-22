const isPreliminary = (item) => /concurso listado\s*·\s*verificar/i.test(item?.status || "");

const snapshotValue = value => {
  if (value == null || value === "") return "";
  if (typeof value === "object" && !Array.isArray(value)) {
    return String(value.valor ?? value.value ?? value.amount ?? "");
  }
  return String(value);
};

const formatValue = (value) => {
  const normalized = snapshotValue(value);
  return normalized === "" ? "não informado" : normalized;
};

export function buildCatalogSnapshot(catalog = []) {
  return catalog
    .filter((item) => item && item.id != null)
    .map((item) => {
      const history = Array.isArray(item.historicoAtualizacoes) ? item.historicoAtualizacoes : [];
      const lastHistory = history.length ? history[history.length - 1] : null;
      return {
        id: String(item.id),
        cargo: String(item.cargo || ""),
        orgao: String(item.orgao || ""),
        status: String(item.status || ""),
        vagas: item.vagas ?? null,
        nivel: String(item.nivel || ""),
        estado: String(item.estado || ""),
        localidade: String(item.localidade || ""),
        atoOficial: String(item.atoOficial || ""),
        sourceUrl: String(item.sourceUrl || ""),
        remuneracao: snapshotValue(item.remuneracao ?? item.salario ?? item.salarioInicial
          ?? item.remuneracaoInicial ?? item.vencimento),
        vagasImediatas: item.vagasImediatas ?? null,
        cadastroReserva: item.cadastroReserva ?? null,
        prazoInscricao: String(item.prazoInscricao || ""),
        dataProva: String(item.dataProva || ""),
        dataResultado: String(item.dataResultado || ""),
        historyCount: history.length,
        lastHistoryAt: String(lastHistory?.at || ""),
        lastHistoryType: String(lastHistory?.type || ""),
        lastHistoryChanges: Array.isArray(lastHistory?.changes)
          ? lastHistory.changes.slice(0, 12).map(change => ({
            field: String(change.field || ""),
            label: String(change.label || ""),
            oldValue: change.oldValue ?? change.from ?? null,
            newValue: change.newValue ?? change.to ?? null
          }))
          : []
      };
    });
}

export function detectCatalogNotifications({
  catalog = [],
  previousSnapshot,
  favoriteIds = []
} = {}) {
  const snapshot = buildCatalogSnapshot(catalog);
  if (!Array.isArray(previousSnapshot)) {
    return { snapshot, notifications: [], initialized: true };
  }

  const previousById = new Map(previousSnapshot.map((item) => [String(item.id), item]));
  const favorites = new Set(favoriteIds.map(String));
  const notifications = [];

  for (const item of snapshot) {
    const previous = previousById.get(item.id);
    if (!previous) {
      if (isPreliminary(item)) continue;
      notifications.push({
        id: "new-" + item.id,
        type: "new",
        itemId: item.id,
        title: "Novo concurso no catálogo",
        message: item.cargo + " — " + item.orgao,
        createdAt: new Date().toISOString(),
        read: false
      });
      continue;
    }

    if (!favorites.has(item.id)) continue;
    const changes = [];
    const reportedFields = new Set();
    const hasNewRetification = item.historyCount > (Number(previous.historyCount) || 0)
      && item.lastHistoryType === "retificacao";
    if (hasNewRetification) changes.push("Retificação oficial publicada");

    const addChange = (field, label, previousValue, nextValue) => {
      // Snapshots antigos não têm linha de base para os novos campos.
      if (!Object.prototype.hasOwnProperty.call(previous, field)) return;
      const before = previousValue == null ? "" : String(previousValue);
      const after = nextValue == null ? "" : String(nextValue);
      if (before === after || reportedFields.has(field)) return;
      reportedFields.add(field);
      changes.push(label + ": " + formatValue(before) + " → " + formatValue(after));
    };

    addChange("status", "Situação", previous.status, item.status);
    addChange("vagas", "Vagas", previous.vagas, item.vagas);
    if (previous.atoOficial !== item.atoOficial) {
      reportedFields.add("atoOficial");
      changes.push("Ato ou edital atualizado");
    }
    if (previous.cargo !== item.cargo || previous.orgao !== item.orgao) {
      reportedFields.add("cargo");
      changes.push("Cargo ou órgão atualizado");
    }
    if (previous.nivel !== item.nivel || previous.localidade !== item.localidade || previous.estado !== item.estado) {
      reportedFields.add("requisitos");
      changes.push("Requisito ou localidade atualizado");
    }
    if (previous.sourceUrl !== item.sourceUrl) {
      reportedFields.add("sourceUrl");
      changes.push("Link da fonte atualizado");
    }

    addChange("remuneracao", "Remuneração", previous.remuneracao, item.remuneracao);
    addChange("vagasImediatas", "Vagas imediatas", previous.vagasImediatas, item.vagasImediatas);
    addChange("cadastroReserva", "Cadastro de reserva", previous.cadastroReserva, item.cadastroReserva);
    addChange("prazoInscricao", "Prazo de inscrição", previous.prazoInscricao, item.prazoInscricao);
    addChange("dataProva", "Data da prova", previous.dataProva, item.dataProva);
    addChange("dataResultado", "Data do resultado", previous.dataResultado, item.dataResultado);

    if (hasNewRetification) {
      for (const entry of item.lastHistoryChanges) {
        if (!entry || !entry.field || reportedFields.has(entry.field)) continue;
        const label = entry.label || entry.field;
        const before = entry.oldValue ?? "";
        const after = entry.newValue ?? "";
        reportedFields.add(entry.field);
        changes.push(label + ": " + formatValue(before) + " → " + formatValue(after));
      }
    }

    if (changes.length) {
      notifications.push({
        id: hasNewRetification
          ? "retification-" + item.id + "-" + encodeURIComponent(item.lastHistoryAt || String(item.historyCount)).slice(0, 80)
          : "favorite-" + item.id + "-" + encodeURIComponent(changes.join("|")).slice(0, 100),
        type: hasNewRetification ? "retification" : "favorite-update",
        itemId: item.id,
        title: hasNewRetification ? "Retificação oficial no seu favorito" : "Concurso favorito atualizado",
        message: item.cargo + ": " + changes.join(" · "),
        createdAt: new Date().toISOString(),
        read: false
      });
    }
  }

  return { snapshot, notifications, initialized: false };
}

export function dismissNotificationHistory(notifications = [], dismissedAt = new Date().toISOString()) {
  return notifications
    .filter((item) => item && item.id != null)
    .map((item) => ({
      id: String(item.id),
      read: true,
      dismissedAt: item.dismissedAt || dismissedAt
    }));
}

export function mergeNotificationHistory(remote = [], local = []) {
  const merged = new Map();
  for (const item of [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])]) {
    if (!item || item.id == null) continue;
    const id = String(item.id);
    const previous = merged.get(id);
    if (!previous) {
      merged.set(id, item);
      continue;
    }

    const dismissal = previous.dismissedAt ? previous : item.dismissedAt ? item : null;
    if (dismissal) {
      const timestamps = [previous.dismissedAt, item.dismissedAt].filter(Boolean).sort();
      merged.set(id, { id, read: true, dismissedAt: timestamps[0] || dismissal.dismissedAt });
      continue;
    }

    merged.set(id, {
      ...previous,
      ...item,
      id,
      read: Boolean(previous.read || item.read)
    });
  }
  return [...merged.values()];
}

export function getVisibleNotifications(notifications = []) {
  return notifications.filter((item) => item && !item.dismissedAt);
}

export function dismissNotificationById(notifications = [], notificationId, dismissedAt = new Date().toISOString()) {
  return notifications.map((item) => {
    if (!item || String(item.id) !== String(notificationId)) return item;
    return {
      id: String(item.id),
      read: true,
      dismissedAt: item.dismissedAt || dismissedAt
    };
  });
}
