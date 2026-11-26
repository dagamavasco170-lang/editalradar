import { describe, expect, it } from "vitest";
import { buildCatalogSnapshot, detectCatalogNotifications, dismissNotificationById, dismissNotificationHistory, getVisibleNotifications, mergeNotificationHistory } from "./notifications";

const contest = (overrides = {}) => ({
  id: 10,
  cargo: "Analista",
  orgao: "Órgão público",
  status: "Inscrições abertas",
  vagas: 20,
  nivel: "Superior",
  estado: "Alagoas",
  localidade: "Maceió",
  atoOficial: "Edital 01/2026",
  sourceUrl: "https://example.gov.br/concurso",
  ...overrides
});

describe("Notificações do catálogo", () => {
  it("cria uma linha de base na primeira visita sem gerar alertas falsos", () => {
    const result = detectCatalogNotifications({ catalog: [contest()] });
    expect(result.initialized).toBe(true);
    expect(result.notifications).toEqual([]);
    expect(result.snapshot).toEqual(buildCatalogSnapshot([contest()]));
  });

  it("detecta um novo concurso após uma atualização do catálogo", () => {
    const previousSnapshot = buildCatalogSnapshot([contest()]);
    const added = contest({ id: 11, cargo: "Técnico" });
    const result = detectCatalogNotifications({
      catalog: [contest(), added],
      previousSnapshot
    });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]).toEqual(expect.objectContaining({
      type: "new",
      itemId: "11",
      title: "Novo concurso no catálogo",
      read: false
    }));
  });

  it("avisa quando a situação ou o número de vagas de um favorito muda", () => {
    const previousSnapshot = buildCatalogSnapshot([contest()]);
    const updated = contest({ status: "Resultado publicado", vagas: 25 });
    const result = detectCatalogNotifications({
      catalog: [updated],
      previousSnapshot,
      favoriteIds: [10]
    });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].type).toBe("favorite-update");
    expect(result.notifications[0].message).toContain("Resultado publicado");
    expect(result.notifications[0].message).toContain("20 → 25");
  });

  it("gera aviso específico quando um concurso favorito recebe retificação oficial", () => {
    const previousSnapshot = buildCatalogSnapshot([contest()]);
    const updated = contest({
      vagas: 30,
      historicoAtualizacoes: [{
        at: "2026-11-21T18:30:00.000Z",
        type: "retificacao",
        title: "1ª Retificação do Edital 01/2026",
        changes: [{ field: "vagas", oldValue: 20, newValue: 30 }]
      }]
    });
    const result = detectCatalogNotifications({
      catalog: [updated],
      previousSnapshot,
      favoriteIds: [10]
    });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]).toEqual(expect.objectContaining({
      type: "retification",
      itemId: "10",
      title: "Retificação oficial no seu favorito",
      read: false
    }));
    expect(result.notifications[0].message).toContain("Retificação oficial publicada");
    expect(result.notifications[0].message).toContain("20 → 30");
    expect(result.notifications[0].id).toContain("retification-10-");
  });

  it("notifica favoritos com detalhes de remuneração, vagas imediatas, reserva e cronograma", () => {
    const previous = contest({
      remuneracao: { valor: "R$ 2.000,00" },
      vagasImediatas: 10,
      cadastroReserva: 5,
      prazoInscricao: "10/12/2026",
      dataProva: "15/01/2027"
    });
    const previousSnapshot = buildCatalogSnapshot([previous]);
    const updated = contest({
      remuneracao: { valor: "R$ 2.450,00" },
      vagasImediatas: 15,
      cadastroReserva: 10,
      prazoInscricao: "20/12/2026",
      dataProva: "22/01/2027",
      historicoAtualizacoes: [{
        at: "2026-11-22T13:00:00.000Z",
        type: "retificacao",
        title: "Retificação do Edital 01/2026",
        changes: [
          { field: "remuneracao", oldValue: { valor: "R$ 2.000,00" }, newValue: { valor: "R$ 2.450,00" } },
          { field: "vagasImediatas", oldValue: 10, newValue: 15 },
          { field: "cadastroReserva", oldValue: 5, newValue: 10 },
          { field: "prazoInscricao", oldValue: "10/12/2026", newValue: "20/12/2026" },
          { field: "dataProva", oldValue: "15/01/2027", newValue: "22/01/2027" }
        ]
      }]
    });
    const result = detectCatalogNotifications({
      catalog: [updated],
      previousSnapshot,
      favoriteIds: [10]
    });

    expect(result.notifications).toHaveLength(1);
    const message = result.notifications[0].message;
    expect(message).toContain("Remuneração: R$ 2.000,00 → R$ 2.450,00");
    expect(message).toContain("Vagas imediatas: 10 → 15");
    expect(message).toContain("Cadastro de reserva: 5 → 10");
    expect(message).toContain("Prazo de inscrição: 10/12/2026 → 20/12/2026");
    expect(message).toContain("Data da prova: 15/01/2027 → 22/01/2027");
  });

  it("não gera alertas falsos na primeira atualização de snapshots antigos", () => {
    const previousSnapshot = buildCatalogSnapshot([contest()]).map(item => {
      const oldVersion = { ...item };
      delete oldVersion.remuneracao;
      delete oldVersion.vagasImediatas;
      delete oldVersion.cadastroReserva;
      delete oldVersion.prazoInscricao;
      delete oldVersion.dataProva;
      delete oldVersion.dataResultado;
      delete oldVersion.lastHistoryChanges;
      return oldVersion;
    });
    const updated = contest({
      remuneracao: { valor: "R$ 2.000,00" },
      vagasImediatas: 20,
      cadastroReserva: 5,
      prazoInscricao: "20/12/2026",
      dataProva: "22/01/2027"
    });
    const result = detectCatalogNotifications({
      catalog: [updated],
      previousSnapshot,
      favoriteIds: [10]
    });
    expect(result.notifications).toEqual([]);
  });

  it("não gera aviso de retificação quando o concurso não é favorito", () => {
    const previousSnapshot = buildCatalogSnapshot([contest()]);
    const result = detectCatalogNotifications({
      catalog: [contest({
        historicoAtualizacoes: [{
          at: "2026-11-21T18:30:00.000Z",
          type: "retificacao",
          changes: [{ field: "vagas", oldValue: 20, newValue: 30 }]
        }]
      })],
      previousSnapshot,
      favoriteIds: []
    });

    expect(result.notifications).toEqual([]);
  });

  it("não repete o aviso quando o histórico de retificações não cresceu", () => {
    const current = contest({
      historicoAtualizacoes: [{
        at: "2026-11-21T18:30:00.000Z",
        type: "retificacao",
        changes: [{ field: "vagas", oldValue: 20, newValue: 30 }]
      }]
    });
    const previousSnapshot = buildCatalogSnapshot([current]);
    const result = detectCatalogNotifications({
      catalog: [current],
      previousSnapshot,
      favoriteIds: [10]
    });

    expect(result.notifications).toEqual([]);
  });

  it("não avisa sobre mudanças em concursos que não são favoritos", () => {
    const previousSnapshot = buildCatalogSnapshot([contest()]);
    const result = detectCatalogNotifications({
      catalog: [contest({ status: "Resultado publicado" })],
      previousSnapshot,
      favoriteIds: []
    });

    expect(result.notifications).toEqual([]);
  });

  it("ignora a inclusão de referências preliminares sem confirmação", () => {
    const previousSnapshot = buildCatalogSnapshot([contest()]);
    const preliminary = contest({
      id: 12,
      status: "Concurso listado · verificar edital e cronograma"
    });
    const result = detectCatalogNotifications({
      catalog: [contest(), preliminary],
      previousSnapshot
    });

    expect(result.notifications).toEqual([]);
  });
});


describe("Histórico de notificações dispensadas", () => {
  it("guarda apenas o identificador ao limpar e não o mostra novamente", () => {
    const original = [
      { id: "new-21", title: "Novo concurso", message: "Aviso", read: false },
      { id: "retification-10-2026-11-21", title: "Retificação", message: "Aviso", read: true }
    ];
    const dismissed = dismissNotificationHistory(original, "2026-11-21T19:00:00.000Z");

    expect(dismissed).toEqual([
      { id: "new-21", read: true, dismissedAt: "2026-11-21T19:00:00.000Z" },
      { id: "retification-10-2026-11-21", read: true, dismissedAt: "2026-11-21T19:00:00.000Z" }
    ]);
    expect(getVisibleNotifications(dismissed)).toEqual([]);
  });

  it("não restaura do servidor uma notificação que já foi apagada localmente", () => {
    const remote = [{ id: "new-21", title: "Novo concurso", message: "Aviso", read: false }];
    const local = [{ id: "new-21", read: true, dismissedAt: "2026-11-21T19:00:00.000Z" }];

    expect(mergeNotificationHistory(remote, local)).toEqual(local);
  });


  it("preserva como lida uma notificação quando apenas um dispositivo sincronizou a leitura", () => {
    const remote = [{ id: "new-23", title: "Concurso novo", message: "Aviso", read: false }];
    const local = [{ id: "new-23", title: "Concurso novo", message: "Aviso", read: true }];
    expect(mergeNotificationHistory(remote, local)).toEqual([
      { id: "new-23", title: "Concurso novo", message: "Aviso", read: true }
    ]);
  });

  it("não reabre como não lida quando a cópia remota já estava lida", () => {
    const remote = [{ id: "new-24", title: "Concurso", read: true }];
    const local = [{ id: "new-24", title: "Concurso", read: false }];
    expect(mergeNotificationHistory(remote, local)[0].read).toBe(true);
  });

  it("mantém a dispensa mesmo quando o tombstone vem primeiro ou depois", () => {
    const tombstone = { id: "new-25", read: true, dismissedAt: "2026-11-21T19:00:00.000Z" };
    const active = { id: "new-25", title: "Concurso", read: false };
    expect(mergeNotificationHistory([tombstone], [active])).toEqual([tombstone]);
    expect(mergeNotificationHistory([active], [tombstone])).toEqual([tombstone]);
  });

  it("preserva no histórico as notificações dispensadas durante uma sincronização", () => {
    const remote = [
      { id: "new-20", title: "Concurso anterior", read: false },
      { id: "new-21", title: "Concurso novo", read: false }
    ];
    const local = [
      { id: "new-20", read: true, dismissedAt: "2026-11-21T19:00:00.000Z" },
      { id: "new-22", title: "Outro concurso", read: false }
    ];

    expect(mergeNotificationHistory(remote, local)).toEqual([
      local[0],
      remote[1],
      local[1]
    ]);
  });
});


describe("Dispensar uma notificação individual", () => {
  it("apaga somente o aviso selecionado e mantém seu identificador", () => {
    const original = [
      { id: "new-21", title: "Aviso A", message: "A", read: false },
      { id: "retification-10-2026", title: "Aviso B", message: "B", read: false }
    ];
    const result = dismissNotificationById(original, "new-21", "2026-11-21T20:00:00.000Z");

    expect(result[0]).toEqual({
      id: "new-21",
      read: true,
      dismissedAt: "2026-11-21T20:00:00.000Z"
    });
    expect(result[1]).toEqual(original[1]);
    expect(getVisibleNotifications(result)).toEqual([original[1]]);
  });
});
