import { expect, test } from "@playwright/test";

test("opens a fixed-style demo and runs transient steps", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开内置演示" }).click();
  await expect(page).toHaveURL(/\/viewer\/[0-9a-f-]+$/);
  await expect(page.getByRole("img", { name: "冒泡排序" })).toBeVisible();
  const themeHash = await page.locator(".canvas-shell").getAttribute("data-theme-token-hash");
  expect(themeHash).toMatch(/^[a-f0-9]{8}$/);
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByText("比较 5 和 2")).toBeVisible();
  await expect(page.locator(".canvas-shell")).toHaveAttribute("data-theme-token-hash", themeHash!);
});
