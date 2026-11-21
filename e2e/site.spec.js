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
  await page.getByPlaceholder("Buscar cargo ou órgão...").fill("Agência Reguladora");

  await expect(page.getByText("Listagem de referência")).toBeVisible();
  await page.getByRole("button", { name: /Ver detalhes/ }).click();
  await expect(page.getByRole("link", { name: /Abrir listagem de referência — não é edital/ }))
    .toHaveAttribute("href", "https://concursor.com.br/editais?uf=AL");
});

test("abre a página individual de um concurso com cronograma e fonte oficial", async ({ page }) => {
  await page.goto("./");
  await page.getByPlaceholder("Buscar cargo ou órgão...").fill("Polícia Civil");
  await page.getByRole("button", { name: /Ver detalhes/ }).click();

  await expect(page.getByRole("heading", { name: "Agente e Escrivão de Polícia Civil" })).toBeVisible();
  await expect(page.getByText(/5.318,63/)).toBeVisible();
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
  await expect(page.getByText("37 registros")).toBeVisible();
  await page.getByRole("button", { name: /Ver detalhes/ }).first().click();
  await expect(page.getByRole("heading", { name: "Aluno-Soldado PM do Quadro de Praças" })).toBeVisible();
  await expect(page.getByText(/5.482,51/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Fundação Vunesp — concurso PMES2603" }))
    .toHaveAttribute("href", "https://www.vunesp.com.br/PMES2603");
});
