const DATE_PATTERNS = [
  {
    type: "deadline",
    label: "Fim das inscrições",
    expression: /\\binscri(?:ç|c)ões(?:\\s+abertas)?\\s+até\\s+(\\d{2}\\/\\d{2}\\/\\d{4})/i
  },
  {
    type: "result",
    label: "Resultado previsto",
    expression: /\\bresultado(?:\\s+\\w+)?\\s+(?:previsto|prevista)\\s+em\\s+(\\d{2}\\/\\d{2}\\/\\d{4})/i
  },
  {
    type: "exam",
    label: "Prova",
    expression: /\\bprovas?(?:\\s+(?:objetiva|discursiva|prática|pratica))?\\s+(?:prevista?\\s+)?(?:em|para)\\s+(\\d{2}\\/\\d{2}\\/\\d{4})/i
  }
];

const parseBrazilianDate = (value) => {
  const match = /^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/.exec(value || "");
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) {
    return null;
  }
  return date;
};

export const getUpcomingMilestones = (catalog = [], now = new Date(), limit = 5) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const events = [];

  for (const item of Array.isArray(catalog) ? catalog : []) {
    if (!item || typeof item !== "object") continue;
    const status = String(item.status || "");
    if (/concurso listado\\s*·\\s*verificar/i.test(status)) continue;

    for (const pattern of DATE_PATTERNS) {
      const match = pattern.expression.exec(status);
      if (!match) continue;
      const date = parseBrazilianDate(match[1]);
      if (!date || date < today) continue;
      events.push({
        id: item.id,
        type: pattern.type,
        label: pattern.label,
        title: item.cargo || "Concurso sem cargo informado",
        orgao: item.orgao || "Órgão não informado",
        date
      });
    }
  }

  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 5;
  return events
    .sort((a, b) => a.date.getTime() - b.date.getTime() || String(a.title).localeCompare(String(b.title), "pt-BR"))
    .slice(0, safeLimit);
};
