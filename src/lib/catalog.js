export function applyCatalogOverrides(baseCatalog = [], records = []) {
  const byId = new Map();
  for (const row of records) {
    if (!row || row.id == null) continue;
    byId.set(String(row.id), row);
  }

  const baseIds = new Set(baseCatalog.map(item => String(item.id)));
  const updatedBase = baseCatalog.map(item => {
    const row = byId.get(String(item.id));
    if (!row) return item;
    if (row.deleted) return null;
    return { ...item, ...(row.data || {}), id: item.id };
  }).filter(Boolean);

  const addedById = new Map();
  for (const row of byId.values()) {
    if (row.deleted || baseIds.has(String(row.id))) continue;
    const numericId = Number(row.id);
    const id = Number.isSafeInteger(numericId) ? numericId : String(row.id);
    addedById.set(String(row.id), { ...(row.data || {}), id });
  }

  return [...updatedBase, ...addedById.values()];
}
