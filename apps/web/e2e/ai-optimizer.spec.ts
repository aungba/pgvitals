import { test, expect } from "@playwright/test";
import { setupApiMocks, MOCK_DB_ID } from "./helpers/mock-api";

test.describe("AI Query Explainer & Rewriter", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.goto(`/databases/${MOCK_DB_ID}/queries`);
  });

  test("opens AI Query Optimizer modal from query detail pane", async ({ page }) => {
    // Select the first query row
    const firstRow = page.locator("tr.alert-table-row").first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    // Click the 🤖 AI Optimize button
    const aiBtn = page.getByRole("button", { name: /AI Optimize/i }).first();
    await expect(aiBtn).toBeVisible();
    await aiBtn.click();

    // Verify modal appears
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(modal.getByText("AI Query Explainer & Optimizer")).toBeVisible();

    // Verify executive diagnosis and bottlenecks rendered
    await expect(modal.getByText("Executive Diagnosis")).toBeVisible();
    await expect(modal.getByRole("heading", { name: /Sequential Scan/i })).toBeVisible();

    // Switch to Rewritten SQL tab
    const rewriteTab = modal.getByRole("button", { name: /Rewritten SQL/i });
    await rewriteTab.click();
    await expect(modal.getByText(/PG Vitals Optimized Query/i)).toBeVisible();

    // Switch to Recommended Indexes tab
    const indexTab = modal.getByRole("button", { name: /Recommended Index/i });
    await indexTab.click();
    await expect(modal.getByText(/CREATE INDEX CONCURRENTLY/i)).toBeVisible();

    // Close the modal
    const closeBtn = modal.getByRole("button", { name: "Close" });
    await closeBtn.click();
    await expect(modal).not.toBeVisible();
  });
});
