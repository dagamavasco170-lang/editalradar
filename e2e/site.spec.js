import { test, expect } from "@playwright/test";

test("abre a versão de produção e não gera erros JavaScript", async ({ page }) => {
  const pageErrors = [];
  const failedAssets = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/editalradar/assets/") && !response.ok()) {
      failedAssets.push(`${response.status()} ${url}`);
    }
  });

  const response = await page.goto("./");
  expect(response, "o servidor de produção deve responder").not.toBeNull();
  expect(response.status()).toBe(200);

  await expect(
    page.getByRole("heading", { name: "Encontre concursos com informação verificada" })
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
