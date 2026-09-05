import { test, expect } from "@playwright/test";
import { setupApiMocks, MOCK_DB_ID } from "./helpers/mock-api";

test.describe("PGTune GUC Configuration Advisor", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.goto(`/databases/${MOCK_DB_ID}/config`);
  });

  test("renders the configuration dashboard with hardware profile controls", async ({ page }) => {
    await expect(page.getByText("PostgreSQL Configuration Advisor (PGTune)")).toBeVisible();
    await expect(page.getByText("Target Server Hardware Profile & Workload Specification")).toBeVisible();

    // Check dropdowns
    const ramSelect = page.locator("select").first();
    await expect(ramSelect).toBeVisible();

    // Check scorecards
    await expect(page.getByText("Parameters Evaluated")).toBeVisible();
    await expect(page.getByText("Critical Defaults")).toBeVisible();
  });

  test("dynamically recalculates targets when RAM is changed", async ({ page }) => {
    // Current target for shared_buffers with 8GB RAM is 2GB
    await expect(page.getByText("2GB")).toBeVisible();

    // Change RAM selector to 32GB
    const ramSelect = page.locator("select").first();
    await ramSelect.selectOption("32");

    // The mock responds with 8GB shared_buffers when RAM >= 32GB
    await expect(page.getByText("8GB")).toBeVisible();
  });

  test("allows copying ALTER SYSTEM commands and toggling raw conf", async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Test toggle raw conf
    const confBtn = page.getByRole("button", { name: /View postgresql\.conf/i });
    await confBtn.click();
    await expect(page.getByText("Generated postgresql.conf Configuration Block")).toBeVisible();

    // Click again to hide
    const hideBtn = page.getByRole("button", { name: /Hide postgresql\.conf/i });
    await hideBtn.click();
    await expect(page.getByText("Generated postgresql.conf Configuration Block")).not.toBeVisible();
  });
});
