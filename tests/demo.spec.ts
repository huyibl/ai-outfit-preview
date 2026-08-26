import { expect, test } from "@playwright/test";

test("virtual try-on demo v2", async ({ page }) => {
  test.setTimeout(420_000);
  await page.addInitScript(() => {
    localStorage.clear();
    indexedDB.deleteDatabase("ai-outfit-preview");
  });

  await page.goto("/");
  await expect(page.getByTestId("wardrobe-count")).toHaveText("6件单品", { timeout: 20_000 });

  await page.getByTestId("model-female").click();
  await page.getByTestId("mode-tryon").click();
  await expect(page.getByTestId("upload-model")).toBeVisible();
  await page.waitForTimeout(700);
  await page.screenshot({ path: "docs/demo-01-tryon-mode.png", fullPage: true });

  await page.getByTestId("wardrobe-search").fill("橙");
  await expect(page.getByTestId("add-seed-jacket-orange")).toBeVisible();
  await page.getByTestId("add-seed-jacket-orange").click();

  await page.getByTestId("wardrobe-search").fill("红");
  await page.getByTestId("add-seed-coat-red").click();

  await page.getByTestId("wardrobe-search").fill("");
  await page.getByTestId("add-seed-skirt-grey").click();

  await expect(page.getByTestId("canvas-item-seed-jacket-orange")).toBeVisible();
  await expect(page.getByTestId("canvas-item-seed-coat-red")).toBeVisible();
  await expect(page.getByTestId("canvas-item-seed-skirt-grey")).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "docs/demo-02-outfit.png", fullPage: true });

  await page.getByTestId("generate-preview").click();
  await expect(page.getByTestId("generating")).toBeVisible();
  await expect(page.getByTestId("generating")).toBeHidden({ timeout: 360_000 });
  await expect(page.getByTestId("preview-image")).toBeVisible();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: "docs/tryon-preview.png", fullPage: true });

  await page.getByTestId("save-outfit").click();
  await expect(page.getByTestId("toast")).toContainText("套装已保存");
  await page.waitForTimeout(1400);
});
