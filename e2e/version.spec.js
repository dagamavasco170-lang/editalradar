import { test, expect } from "@playwright/test";

const expectedCommit = process.env.EXPECTED_APP_COMMIT;

test("confirma que o ambiente publicado serve o commit esperado", async ({ page }) => {
  test.skip(!expectedCommit, "A verificação de SHA é habilitada somente nos ambientes de CI.");
  const response = await page.goto("./");
  expect(response, "o ambiente deve responder antes da checagem de versão").not.toBeNull();
  expect(response.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("data-app-commit", expectedCommit);
});
