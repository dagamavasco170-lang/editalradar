export function applyCatalogOverrides(baseCatalog = [], records = []) {
  const byId = new Map(records.filter(row => row && row.id != null).map(row => [String(row.id), row]));
  const baseIds = new Set(baseCatalog.map(item => String(item.id)));
  const updatedBase = baseCatalog.map(item => {
    const row = byId.get(String(item.id));
    if (!row) return item;
    if (row.deleted) return null;
    return { ...item, ...(row.data || {}), id: item.id };
  }).filter(Boolean);
  const added = records.filter(row => row && row.id != null && !row.deleted && !baseIds.has(String(row.id)))
    .map(row => ({ ...(row.data || {}), id: Number(row.id) }));
  return [...updatedBase, ...added];
}
