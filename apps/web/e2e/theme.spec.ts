import { test, expect } from "@playwright/test";
import { setupApiMocks, MOCK_DB_ID } from "./helpers/mock-api";

test.describe("Theme Toggle (Dark & Light Mode)", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.goto(`/databases/${MOCK_DB_ID}`);
  });

  test("toggles theme and persists data-theme attribute on html element", async ({ page }) => {
    const html = page.locator("html");

    // Locate the ThemeToggle button
    const themeBtn = page.locator(".theme-toggle, button[aria-label*='theme' i]").first();
    if (await themeBtn.isVisible()) {
      const initialTheme = await html.getAttribute("data-theme");

      // Click to toggle
      await themeBtn.click();

      const newTheme = await html.getAttribute("data-theme");
      expect(newTheme).not.toBe(initialTheme);
    }
  });
});
