import { test, expect } from "@playwright/test";

test("abre a versão de produção e não gera erros JavaScript", async ({ page }) => {
  const pageErrors = [];
  const failedAssets = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/assets/") && !response.ok()) {
      failedAssets.push(`${response.status()} ${url}`);
    }
  });

  const response = await page.goto("./");
  expect(response, "o servidor de produção deve responder").not.toBeNull();
  expect(response.status()).toBe(200);

  await expect(
    page.getByRole("heading", { name: /Encontre concursos/ })
  ).toBeVisible();

  await expect(page.getByText("Banco Central do Brasil").first()).toBeVisible();
  expect(pageErrors, "erros JavaScript no navegador").toEqual([]);
  expect(failedAssets, "arquivos JavaScript/CSS que não carregaram").toEqual([]);
});

test("pesquisa concursos pelo nome do órgão no navegador", async ({ page }) => {
  await page.goto("./");
  const search = page.getByPlaceholder("Buscar cargo ou órgão...");
  await expect(search).toBeVisible();
  await search.fill("Controladoria");

  await expect(page.getByText("Controladoria-Geral da União").first()).toBeVisible();
  await expect(page.getByText("Banco Central do Brasil")).toHaveCount(0);
});

test("salva um concurso nos favoritos no navegador", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Salvar favorito").first().click();
  await page.getByRole("button", { name: /Meus favoritos/ }).click();

  await expect(
    page.getByRole("heading", { name: "Seus concursos favoritos" })
  ).toBeVisible();
  await expect(page.getByText("Auditor — Carreira de Especialista")).toBeVisible();
});

test("filtra concursos estaduais e municipais por estado e cidade", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Esfera").selectOption("Estadual");
  await expect(page.getByText("Polícia Civil do Estado de Alagoas").first()).toBeVisible();
  await expect(page.getByText("Banco Central do Brasil")).toHaveCount(0);

  await page.getByLabel("Esfera").selectOption("Todas as esferas");
  await page.getByLabel("Cidade").selectOption("Paripueira");
  await expect(page.getByText("Cargos efetivos a definir")).toBeVisible();
  await expect(page.locator(".cards").getByText("Professor — Matemática (lotação em Paripueira)")).toBeVisible();
});

test("identifica claramente um registro preliminar que não possui edital confirmado", async ({ page }) => {
  await page.goto("./");
  await page.getByPlaceholder("Buscar cargo ou órgão...").fill("Departamento de Estradas e Rodagem");

  await expect(page.getByText("Listagem de referência")).toBeVisible();
  await page.getByRole("button", { name: /Ver detalhes/ }).click();
  await expect(page.getByRole("link", { name: /Abrir referência externa — confirme no órgão/ }))
    .toHaveAttribute("href", "https://concursor.com.br/editais?uf=AL");
});

test("oferece acesso ao banco de provas original do PCI Concursos", async ({ page }) => {
  await page.goto("./");
  const pciCatalog = page.getByRole("link", { name: "Consultar acervo de provas do PCI Concursos" });
  await expect(pciCatalog).toBeVisible();
  await expect(pciCatalog).toHaveAttribute("href", "https://www.pciconcursos.com.br/provas/");
  await expect(pciCatalog).toHaveAttribute("target", "_blank");
  await expect(page.getByText("Os documentos permanecem hospedados no PCI ou nas fontes indicadas por ele; o EditalRadar não copia nem espelha o acervo.")).toBeVisible();
});

test("abre a página individual de um concurso com cronograma e fonte oficial", async ({ page }) => {
  await page.goto("./");
  await page.getByPlaceholder("Buscar cargo ou órgão...").fill("Polícia Civil");
  await page.getByRole("button", { name: /Ver detalhes/ }).click();

  await expect(page.getByRole("heading", { name: "Agente e Escrivão de Polícia Civil" })).toBeVisible();
  await expect(page.getByText(/5.318,63/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Cebraspe — notícia oficial sobre PC/AL" })).toHaveAttribute("href", "https://www.cebraspe.org.br/cebraspe-noticias-103/");
  await expect(page.getByRole("heading", { name: "Cronograma e etapas" })).toBeVisible();
  await expect(page.locator("#detail-timeline time").filter({ hasText: /06 de dezembro de 2026/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Acessar fonte oficial/ }))
    .toHaveAttribute("href", "https://www.cebraspe.org.br/concursos/pc_al_26");

  await page.getByRole("button", { name: "Preparar para este concurso" }).click();
  await expect(page.getByText("FOCO DA SUA PREPARAÇÃO")).toBeVisible();
  await page.getByRole("button", { name: "Voltar aos detalhes" }).click();
  await expect(page.getByRole("heading", { name: "Agente e Escrivão de Polícia Civil" })).toBeVisible();
  await page.getByRole("button", { name: /Voltar para concursos/ }).click();
  await expect(page.getByRole("heading", { name: "Concursos e avisos no catálogo" })).toBeVisible();
});

test("compara oportunidades e permite remover uma coluna da comparação", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Adicionar Auditor — Carreira de Especialista à comparação" }).click();
  await page.getByRole("button", { name: "Adicionar Técnico — Carreira de Especialista à comparação" }).click();

  await page.getByRole("button", { name: "Comparar concursos (2)" }).click();
  await expect(page.getByRole("heading", { name: "Comparador de concursos" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tabela de comparação dos concursos" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Remuneração" })).toBeVisible();
  await expect(page.getByText("Não informado nesta ficha").first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".compare-table-wrap")).toBeVisible();
  await page.getByRole("button", { name: "Remover Auditor — Carreira de Especialista da comparação" }).click();
  await expect(page.getByText("Escolha pelo menos dois concursos")).toBeVisible();
});

test("salva e remove um alerta personalizado no navegador", async ({ page }) => {
  await page.goto("./");
  await page.getByPlaceholder("Buscar cargo ou órgão...").fill("PROCON");
  await page.getByRole("button", { name: /Salvar alerta/ }).click();

  await expect(page.getByText("PROCON").last()).toBeVisible();
  await expect(page.getByText("1 oportunidade(s) correspondente(s)")).toBeVisible();

  await page.reload();
  await expect(page.getByText("1 oportunidade(s) correspondente(s)")).toBeVisible();
  await page.getByRole("button", { name: /Remover alerta PROCON/ }).click();
  await expect(page.getByText(/Você ainda não salvou alertas/)).toBeVisible();
});

test("abre a experiência de cadastro e login conforme a integração configurada", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /Entrar \/ cadastrar/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /Entrar na sua conta/ })).toBeVisible();

  const hasEmailForm = await dialog.getByLabel("E-mail").count();
  if (hasEmailForm > 0) {
    await expect(dialog.getByLabel("E-mail")).toBeVisible();
    await expect(dialog.getByLabel("Senha")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Continuar com Google" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();

    await dialog.getByRole("button", { name: "Não tem conta? Criar conta" }).click();
    await expect(dialog.getByRole("heading", { name: "Criar sua conta" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Criar conta", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Já tenho uma conta — entrar" }).click();
    await expect(dialog.getByRole("heading", { name: "Entrar na sua conta" })).toBeVisible();

    await dialog.getByRole("button", { name: "Esqueci minha senha" }).click();
    await expect(dialog.getByRole("heading", { name: "Recuperar senha" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Enviar link de recuperação" })).toBeVisible();
  } else {
    await expect(dialog.getByText(/recuperação de senha estão preparados/i)).toBeVisible();
    await expect(dialog.getByRole("link", { name: /Abrir guia de configuração/ })).toBeVisible();
  }
});


test("mostra o concurso PMESP aberto e sua remuneração oficial", async ({ page }) => {
  await page.goto("./");
  await page.getByPlaceholder("Buscar cargo ou órgão...").fill("PMESP");
  await expect(page.getByText("Aluno-Soldado PM do Quadro de Praças").first()).toBeVisible();
  await page.getByRole("button", { name: /Ver detalhes/ }).first().click();
  await expect(page.getByRole("heading", { name: "Aluno-Soldado PM do Quadro de Praças" })).toBeVisible();
  await expect(page.getByText(/5.482,51/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Fundação Vunesp — concurso PMES2603" }))
    .toHaveAttribute("href", "https://www.vunesp.com.br/PMES2603");
});


test("apresenta PMPE e CBMPE com prorrogação de inscrição e faixas salariais por carreira", async ({ page }) => {
  await page.goto("./");
  await page.getByPlaceholder("Buscar cargo ou órgão...").fill("Pernambuco");
  await expect(page.getByText("Inscrições abertas até 23/11/2026 às 14h").first()).toBeVisible();
  await expect(page.getByText("1.320").first()).toBeVisible();
  await expect(page.getByText("570").first()).toBeVisible();
});


test("monta plano semanal e pratica uma questão autoral filtrada por disciplina e banca",async({page})=>{
 await page.goto("./");
 await page.getByRole("button",{name:/Área de estudos/}).click();
 await expect(page.getByRole("heading",{name:"Monte sua rotina"})).toBeVisible();
 await page.getByLabel("Carga horária semanal").selectOption("15");
 await expect(page.getByText("15 h/semana")).toBeVisible();
 await page.reload();
 await page.getByRole("button",{name:/Área de estudos/}).click();
 await expect(page.getByText("15 h/semana")).toBeVisible();
 await page.getByLabel("Filtrar questões por disciplina").selectOption("Direito Constitucional");
 await page.getByLabel("Filtrar questões por estilo de banca").selectOption("Cebraspe");
 await expect(page.getByText(/Questão autoral · estilo Cebraspe/)).toBeVisible();
 await page.getByRole("button",{name:"Certo"}).click();
 await page.getByRole("button",{name:"Conferir resposta"}).click();
 await expect(page.getByText(/art\. 5º, IV/)).toBeVisible();
});


test("mantém navegação inferior utilizável e sem rolagem horizontal no celular", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  const navigation = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("button", { name: /Concursos/ })).toBeVisible();
  await expect(navigation.getByRole("button", { name: /Área de estudos/ })).toBeVisible();
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(pageWidth).toBeLessThanOrEqual(390);
  await navigation.getByRole("button", { name: /Área de estudos/ }).click();
  await expect(page.getByRole("heading", { name: "Monte sua rotina" })).toBeVisible();
});


test("apresenta salário e quatro informações essenciais nos cards do catálogo", async ({ page }) => {
  await page.goto("./");
  const firstCard = page.locator(".contest-card").first();
  await expect(firstCard.locator(".card-facts > span")).toHaveCount(4);
  await expect(firstCard.getByText("REMUNERAÇÃO")).toBeVisible();
  await expect(firstCard.getByRole("button", { name: /Ver detalhes/ })).toBeVisible();
});

test("mantém o novo visual sem rolagem horizontal em celular e tablet", async ({ page }) => {
  for (const width of [360, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./");
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth, `largura excedente em viewport de ${width}px`).toBeLessThanOrEqual(width);
    await expect(page.locator(".hero")).toBeVisible();
    await expect(page.locator(".contest-card").first()).toBeVisible();
  }
});


test("ordena o catálogo e alterna entre grade e lista", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Ordenar concursos").selectOption("name");
  const cargoNames = await page.locator(".contest-card h3").allInnerTexts();
  expect(cargoNames[0].localeCompare(cargoNames[1], "pt-BR")).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Visualização em lista" }).click();
  await expect(page.locator(".cards")).toHaveAttribute("data-view", "list");
  await page.reload();
  await expect(page.locator(".cards")).toHaveAttribute("data-view", "list");
  await expect(page.getByLabel("Ordenar concursos")).toHaveValue("name");
  await page.getByRole("button", { name: "Visualização em grade" }).click();
  await expect(page.locator(".cards")).toHaveAttribute("data-view", "grid");
});

test("exporta favoritos para CSV", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Salvar favorito").first().click();
  await page.getByRole("button", { name: /Meus favoritos/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exportar CSV/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^editalradar-favoritos-.*\.csv$/);
  await expect(page.getByRole("status").filter({ hasText: /exportada\(s\) para CSV/ })).toBeVisible();
});

test("cronômetro de foco permite iniciar, pausar e reiniciar", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /Área de estudos/ }).click();
  await expect(page.getByRole("heading", { name: "Hora de focar em você." })).toBeVisible();
  await expect(page.getByRole("timer")).toContainText("25:00");
  await page.getByRole("button", { name: "Iniciar foco" }).click();
  await expect(page.getByRole("button", { name: "Pausar sessão" })).toBeVisible();
  await page.getByRole("button", { name: "Pausar sessão" }).click();
  await page.getByRole("button", { name: "Reiniciar" }).click();
  await expect(page.getByRole("timer")).toContainText("25:00");
  await page.getByRole("button", { name: /50 min/ }).click();
  await expect(page.getByRole("timer")).toContainText("50:00");
});


test("mantém eixos alinhados e cartões com dimensões uniformes no desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./");
  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const cards = [...document.querySelectorAll(".contest-card")].slice(0, 3).map((element) => {
      const box = element.getBoundingClientRect();
      const footer = element.querySelector(".card-bottom").getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, footerBottom: footer.bottom };
    });
    return {
      breadcrumb: rect(".breadcrumb"),
      hero: rect(".hero"),
      stats: rect(".stats-row"),
      filters: rect(".catalog-filter-panel"),
      cards: rect(".cards"),
      items: cards,
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth
    };
  });
  expect(geometry).not.toBeNull();
  expect(Math.abs(geometry.breadcrumb.left - geometry.hero.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.hero.left - geometry.stats.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.hero.left - geometry.filters.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.hero.left - geometry.cards.left)).toBeLessThanOrEqual(2);
  expect(Math.max(...geometry.items.map(item => item.width)) - Math.min(...geometry.items.map(item => item.width))).toBeLessThanOrEqual(2);
  expect(Math.max(...geometry.items.map(item => item.bottom)) - Math.min(...geometry.items.map(item => item.bottom))).toBeLessThanOrEqual(2);
  expect(Math.max(...geometry.items.map(item => item.footerBottom)) - Math.min(...geometry.items.map(item => item.footerBottom))).toBeLessThanOrEqual(2);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
});

test("mantém grade, filtros e páginas alinhados sem rolagem horizontal em diferentes larguras", async ({ page }) => {
  for (const width of [390, 560, 768, 900, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `rolagem horizontal no catálogo a ${width}px`).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: /Área de estudos/ }).click();
    const studyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(studyOverflow, `rolagem horizontal nos estudos a ${width}px`).toBeLessThanOrEqual(1);
    await page.goto("./");
    await page.getByRole("button", { name: /Ver detalhes/ }).first().click();
    const detailOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(detailOverflow, `rolagem horizontal nos detalhes a ${width}px`).toBeLessThanOrEqual(1);
  }
});


test("alinha a coluna lateral e distribui os itens e o rodapé no desktop", async ({ page }) => {
  for (const width of [1440, 1024, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./");
    const measurements = await page.evaluate(() => {
      const box = (element) => {
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom };
      };
      const sidebar = document.querySelector(".sidebar");
      const nav = sidebar?.querySelector(".sidebar-nav");
      const items = [...(nav?.querySelectorAll(".nav-item") || [])].map(box);
      return {
        sidebar:box(sidebar), main:box(document.querySelector(".main")),
        brand:box(sidebar?.querySelector(".brand")),
        label:box(sidebar?.querySelector(".side-label")),
        nav:box(nav), items,
        help:box(sidebar?.querySelector(".help-card")),
        profile:box(sidebar?.querySelector(".profile")),
        viewport:document.documentElement.clientWidth,
        document:document.documentElement.scrollWidth
      };
    });
    expect(measurements.sidebar.width, `largura da coluna a ${width}px`).toBe(width >= 1181 ? 264 : width >= 901 ? 244 : 224);
    expect(measurements.main.x).toBeGreaterThanOrEqual(measurements.sidebar.right - 1);
    expect(Math.abs(measurements.brand.x - measurements.nav.x)).toBeLessThanOrEqual(1);
    expect(measurements.items.length).toBeGreaterThan(2);
    for (const item of measurements.items) {
      expect(Math.abs(item.x - measurements.nav.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(item.width - measurements.nav.width)).toBeLessThanOrEqual(1);
      expect(item.height).toBeGreaterThanOrEqual(47);
    }
    expect(measurements.help.bottom).toBeLessThanOrEqual(measurements.profile.y + 1);
    expect(measurements.profile.bottom).toBeLessThanOrEqual(measurements.sidebar.bottom + 1);
    expect(measurements.document).toBeLessThanOrEqual(measurements.viewport);
  }
});

test("mantém a navegação inferior centralizada e sem overflow no celular", async ({ page }) => {
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("./");
    const geometry = await page.evaluate(() => {
      const nav = document.querySelector(".sidebar-nav");
      const sidebar = document.querySelector(".sidebar");
      const items = [...nav.querySelectorAll(".nav-item")].map((el) => {
        const r = el.getBoundingClientRect();
        return { left:r.left,right:r.right,width:r.width };
      });
      const s = sidebar.getBoundingClientRect();
      return { items, sidebarLeft:s.left, sidebarRight:s.right, navWidth:nav.getBoundingClientRect().width,
        documentWidth:document.documentElement.scrollWidth, viewport:document.documentElement.clientWidth };
    });
    expect(geometry.sidebarLeft).toBe(0);
    expect(geometry.sidebarRight).toBeLessThanOrEqual(width);
    expect(geometry.items.length).toBeGreaterThan(2);
    expect(geometry.items.every(item => item.width > 0)).toBeTruthy();
    expect(geometry.items[0].left).toBeGreaterThanOrEqual(0);
    expect(geometry.items.at(-1).right).toBeLessThanOrEqual(width);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  }
});


test("banco de questões filtra, salva, registra erros e mantém o caderno após recarregar", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /Área de estudos/ }).click();
  const bank = page.getByRole("region", { name: "Banco de questões" });
  await expect(bank.getByRole("heading", { name: "Banco de questões" })).toBeVisible();
  const summary = bank.locator(".question-bank-subtitle");
  await expect(summary).toContainText("questões disponíveis");
  await expect(summary).toContainText("80 na base inicial");

  await bank.getByPlaceholder("Tema, assunto ou enunciado...").fill("crase");
  await expect(bank.getByRole("heading", { name: /dirigiu-se a comissão/ })).toBeVisible();
  await bank.getByRole("button", { name: "Certo", exact: true }).click();
  await bank.getByRole("button", { name: "Conferir resposta" }).click();
  await expect(bank.getByText(/Resposta incorreta/)).toBeVisible();
  await bank.getByRole("button", { name: "Salvar questão" }).click();
  await bank.getByRole("button", { name: /Caderno de erros/ }).click();
  await expect(bank.getByRole("heading", { name: /dirigiu-se a comissão/ })).toBeVisible();
  await bank.getByRole("button", { name: /Salvas/ }).click();
  await expect(bank.getByRole("heading", { name: /dirigiu-se a comissão/ })).toBeVisible();
  await expect(bank.getByRole("button", { name: "Remover questão salva" })).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await page.getByRole("button", { name: /Área de estudos/ }).click();
  const restoredBank = page.getByRole("region", { name: "Banco de questões" });
  await restoredBank.getByPlaceholder("Tema, assunto ou enunciado...").fill("crase");
  await restoredBank.getByRole("button", { name: /Salvas/ }).click();
  await expect(restoredBank.getByRole("heading", { name: /dirigiu-se a comissão/ })).toBeVisible();
  await expect(restoredBank.getByText(/Última resposta incorreta/)).toBeVisible();
});


test("simulados completos permitem iniciar, finalizar e analisar o desempenho", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /Área de estudos/ }).click();
  const simulator = page.getByRole("region", { name: "Simulados completos" });
  await expect(simulator.getByRole("heading", { name: "Simulados completos" })).toBeVisible();
  await expect(simulator.getByRole("button", { name: /80/ })).toBeEnabled();
  await simulator.getByRole("button", { name: /Iniciar simulado/ }).click();
  await expect(simulator.getByRole("timer")).toBeVisible();
  await expect(simulator.getByText(/Questão 1 de 20/)).toBeVisible();
  await simulator.getByRole("button", { name: /Finalizar e corrigir/ }).click();
  await expect(simulator.getByRole("heading", { name: /de 20 acertos/ })).toBeVisible();
  await simulator.getByRole("button", { name: /Revisar questões/ }).click();
  await expect(simulator.getByText(/Gabarito:/).first()).toBeVisible();
});

test("simulado em andamento recupera respostas, posição e cronômetro após recarregar", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /Área de estudos/ }).click();
  const simulator = page.getByRole("region", { name: "Simulados completos" });
  await simulator.getByRole("button", { name: /Iniciar simulado/ }).click();
  await simulator.locator(".simulator-question-main .option").first().click();
  await simulator.getByRole("button", { name: "Próxima" }).click();
  await expect(simulator.getByText("1 de 20 respondidas")).toBeVisible();
  await expect(simulator.getByText("Questão 2 de 20")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /Área de estudos/ }).click();
  const restored = page.getByRole("region", { name: "Simulados completos" });
  await expect(restored.getByText("Simulado em andamento recuperado")).toBeVisible();
  await expect(restored.getByText("1 de 20 respondidas")).toBeVisible();
  await expect(restored.getByText("Questão 2 de 20")).toBeVisible();
  await expect(restored.getByRole("timer")).toBeVisible();
});

test("catálogo de provas reais aponta para fontes oficiais de provas e gabaritos", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /Área de estudos/ }).click();
  const sources = page.getByRole("region", { name: "Provas reais oficiais" });
  await expect(sources.getByRole("heading", { name: "Provas reais e gabaritos oficiais" })).toBeVisible();
  await expect(sources.getByText(/TRE\/GO/).first()).toBeVisible();
  await expect(sources.getByRole("link", { name: /Abrir caderno de prova/ }).first()).toHaveAttribute("href", /^https:\/\//);
  await expect(sources.getByRole("link", { name: /Abrir gabarito/ }).first()).toHaveAttribute("href", /^https:\/\//);
});
