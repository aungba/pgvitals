import { describe, it, expect } from "vitest";
import { buildBlockingAlertSlackPayload } from "../src/lib/slack-blocks.js";

describe("Slack Block Kit Alerts (Spec §6.3)", () => {
  it("builds interactive blocking chain alert payload with confirmation action", () => {
    const payload = buildBlockingAlertSlackPayload({
      databaseId: "test-db-123",
      databaseName: "prod-db-primary",
      blockerPid: 8419,
      blockedCount: 4,
      durationSeconds: 45,
      querySnippet: "UPDATE orders SET status = 'HOLD' WHERE id = 123;",
    });

    expect(payload.text).toContain("Session 8419 blocking 4 queries on prod-db-primary");
    expect(payload.blocks.length).toBeGreaterThanOrEqual(4);

    const actionBlock = payload.blocks.find((b) => b.type === "actions");
    expect(actionBlock).toBeDefined();

    const terminateBtn: any = (actionBlock as any).elements.find(
      (e: any) => e.action_id === "pgvitals_terminate_session"
    );
    expect(terminateBtn).toBeDefined();
    expect(terminateBtn.style).toBe("danger");
    expect(terminateBtn.confirm).toBeDefined();
    expect(terminateBtn.confirm.title.text).toBe("Confirm Session Kill");

    const parsedValue = JSON.parse(terminateBtn.value);
    expect(parsedValue.dbId).toBe("test-db-123");
    expect(parsedValue.pid).toBe(8419);
  });
});
