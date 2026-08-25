import { expect, test } from "@playwright/test";

test("operation demo txt2img and img2img", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.clear();
    indexedDB.deleteDatabase("ai-outfit-preview");
  });

  await page.goto("/");
  await expect(page.getByTestId("wardrobe-count")).toHaveText("6件单品", { timeout: 20_000 });

  await page.getByTestId("model-female").click();
  await expect(page.getByTestId("mode-tryon")).toBeVisible();
  await page.getByTestId("mode-txt2img").click();

  await page.getByTestId("wardrobe-search").fill("红");
  await expect(page.getByTestId("add-seed-coat-red")).toBeVisible();
  await page.getByTestId("add-seed-coat-red").click();

  await page.getByTestId("wardrobe-search").fill("");
  await page.getByTestId("add-seed-skirt-grey").click();
  await page.getByTestId("add-seed-shoes-white").click();
  await page.getByTestId("add-seed-bag-black").click();

  await expect(page.getByTestId("canvas-item-seed-coat-red")).toBeVisible();
  await expect(page.getByTestId("canvas-item-seed-skirt-grey")).toBeVisible();

  await page.getByTestId("generate-preview").click();
  await expect(page.getByTestId("generating")).toBeVisible();
  await expect(page.getByTestId("generating")).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId("preview-image")).toBeVisible();
  await expect(page.getByTestId("preview-prompt")).toContainText(/AI 接口|本地合成/);
  await page.waitForTimeout(2200);

  await page.getByTestId("mode-img2img").click();
  await page.waitForTimeout(800);
  await page.getByTestId("generate-preview").click();
  await expect(page.getByTestId("generating")).toBeVisible();
  await expect(page.getByTestId("generating")).toBeHidden({ timeout: 240_000 });
  await expect(page.getByTestId("preview-image")).toBeVisible();
  await page.waitForTimeout(2500);

  await page.getByTestId("save-outfit").click();
  await expect(page.getByTestId("toast")).toContainText("套装已保存");
  await page.waitForTimeout(900);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-backup").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/outfit-backup-.*\.json/);

  await page.waitForTimeout(1800);
});
