const isPreliminary = (item) => /concurso listado\s*·\s*verificar/i.test(item?.status || "");

export function buildCatalogSnapshot(catalog = []) {
  return catalog
    .filter((item) => item && item.id != null)
    .map((item) => ({
      id: String(item.id),
      cargo: String(item.cargo || ""),
      orgao: String(item.orgao || ""),
      status: String(item.status || ""),
      vagas: item.vagas ?? null,
      nivel: String(item.nivel || ""),
      estado: String(item.estado || ""),
      localidade: String(item.localidade || ""),
      atoOficial: String(item.atoOficial || ""),
      sourceUrl: String(item.sourceUrl || "")
    }));
}

const formatValue = (value) => value == null || value === "" ? "não informado" : String(value);

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
        id: `new-${item.id}`,
        type: "new",
        itemId: item.id,
        title: "Novo concurso no catálogo",
        message: `${item.cargo} — ${item.orgao}`,
        createdAt: new Date().toISOString(),
        read: false
      });
      continue;
    }

    if (!favorites.has(item.id)) continue;
    const changes = [];
    if (previous.status !== item.status) {
      changes.push(`Situação: ${formatValue(previous.status)} → ${formatValue(item.status)}`);
    }
    if (previous.vagas !== item.vagas) {
      changes.push(`Vagas: ${formatValue(previous.vagas)} → ${formatValue(item.vagas)}`);
    }
    if (previous.atoOficial !== item.atoOficial) {
      changes.push("Ato ou edital atualizado");
    }
    if (previous.cargo !== item.cargo || previous.orgao !== item.orgao) {
      changes.push("Cargo ou órgão atualizado");
    }
    if (previous.nivel !== item.nivel || previous.localidade !== item.localidade || previous.estado !== item.estado) {
      changes.push("Requisito ou localidade atualizado");
    }
    if (previous.sourceUrl !== item.sourceUrl) {
      changes.push("Link da fonte atualizado");
    }
    if (changes.length) {
      notifications.push({
        id: `favorite-${item.id}-${encodeURIComponent(changes.join("|")).slice(0, 100)}`,
        type: "favorite-update",
        itemId: item.id,
        title: "Concurso favorito atualizado",
        message: `${item.cargo}: ${changes.join(" · ")}`,
        createdAt: new Date().toISOString(),
        read: false
      });
    }
  }

  return { snapshot, notifications, initialized: false };
}
