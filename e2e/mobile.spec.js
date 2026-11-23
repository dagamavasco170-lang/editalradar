import { test, expect } from "@playwright/test";

test.describe("Experiência móvel do EditalRadar", () => {
  test.use({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true
  });

  test("mantém o catálogo sem rolagem horizontal em celulares estreitos", async ({ page }) => {
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("./");
      await expect(page.getByRole("heading", { name: /Encontre concursos/ })).toBeVisible();

      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth
      }));
      expect(
        dimensions.document,
        `a página não deve ultrapassar a largura de ${width}px`
      ).toBeLessThanOrEqual(dimensions.viewport + 1);

      await expect(page.locator(".cards").first()).toBeVisible();
    }
  });

  test("a navegação inferior continua acessível por toque na área de estudos", async ({ page }) => {
    await page.goto("./");
    const studyNavigation = page.getByRole("button", { name: /Área de estudos/ });
    await expect(studyNavigation).toBeVisible();

    const bounds = await studyNavigation.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.width).toBeGreaterThanOrEqual(44);

    await studyNavigation.tap();
    await expect(page.getByRole("region", { name: "Banco de questões" })).toBeVisible();
  });

  test("os controles principais permanecem utilizáveis em orientação estreita", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("./");
    const notificationButton = page.getByRole("button", { name: /Ver notificações/ });
    await expect(notificationButton).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);

    await notificationButton.tap();
    await expect(page.getByRole("region", { name: "Notificações do EditalRadar" })).toBeVisible();
  });

  test("mantém o catálogo disponível após a conexão cair, usando o cache do app", async ({ page, context }) => {
    await page.goto("./");
    await expect(page.getByRole("heading", { name: /Encontre concursos/ })).toBeVisible();

    const controlledByServiceWorker = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registration = await navigator.serviceWorker.ready;
      if (!registration.active) return false;

      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
        });
      }
      return Boolean(navigator.serviceWorker.controller);
    });
    expect(controlledByServiceWorker).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: /Encontre concursos/ })).toBeVisible();
  });
});
