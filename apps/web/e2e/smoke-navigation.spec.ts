import { test, expect } from "@playwright/test";
import { setupApiMocks, MOCK_DB_ID } from "./helpers/mock-api";

test.describe("Smoke Navigation & Tab Layout", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
  });

  test("loads the databases overview page successfully", async ({ page }) => {
    await page.goto("/");
    // Expect the page to render database title or cards
    await expect(page).toHaveTitle(/PG Vitals/i);
    await expect(page.locator("body")).toBeVisible();
  });

  test("navigates into database sub-pages via DatabaseNav tabs", async ({ page }) => {
    await page.goto(`/databases/${MOCK_DB_ID}`);

    // Verify database navigation tab bar is present
    const nav = page.locator("nav.db-nav");
    await expect(nav).toBeVisible();

    // Verify all primary tabs exist
    const tabs = ["Overview", "Hints", "Queries", "Indexes", "Health", "Alerts", "Logs", "Plans", "Schema", "Pooler", "Config"];
    for (const tabName of tabs) {
      await expect(nav.getByText(tabName, { exact: false })).toBeVisible();
    }

    // Click on 'Queries' tab
    await nav.getByText("Queries").click();
    await expect(page).toHaveURL(new RegExp(`/databases/${MOCK_DB_ID}/queries`));

    // Click on the new 'Config' tab
    await nav.getByText("Config").click();
    await expect(page).toHaveURL(new RegExp(`/databases/${MOCK_DB_ID}/config`));
    await expect(page.getByText("PostgreSQL Configuration Advisor")).toBeVisible();
  });
});
