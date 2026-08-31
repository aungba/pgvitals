import { describe, it, expect } from "vitest";
import { computeEffectivePlan } from "../src/middleware/auth.js";
import { getLimits } from "../src/middleware/plan-limits.js";

describe("Trial & Plan Limits Architecture", () => {
  describe("computeEffectivePlan", () => {
    it("recognizes active trial and grants Pro capabilities with correct remaining days", () => {
      const tenDaysInFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const result = computeEffectivePlan({
        planTier: "free",
        trialEndsAt: tenDaysInFuture,
      });

      expect(result.isTrialActive).toBe(true);
      expect(result.effectivePlanTier).toBe("pro");
      expect(result.trialDaysRemaining).toBe(10);
      expect(result.trialEndsAt).toBe(tenDaysInFuture.toISOString());
    });

    it("identifies expired trials and falls back gracefully to Free Forever tier", () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const result = computeEffectivePlan({
        planTier: "free",
        trialEndsAt: twoDaysAgo,
      });

      expect(result.isTrialActive).toBe(false);
      expect(result.effectivePlanTier).toBe("free");
      expect(result.trialDaysRemaining).toBeNull();
    });

    it("prioritizes paid Pro plan over trial status", () => {
      const result = computeEffectivePlan({
        planTier: "pro",
        trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      });

      expect(result.isTrialActive).toBe(false);
      expect(result.effectivePlanTier).toBe("pro");
    });

    it("prioritizes paid Team plan over trial status", () => {
      const result = computeEffectivePlan({
        planTier: "team",
      });

      expect(result.isTrialActive).toBe(false);
      expect(result.effectivePlanTier).toBe("team");
    });
  });

  describe("getLimits", () => {
    it("enforces 1 DB limit and basic vitals on Free tier", () => {
      const limits = getLimits("free", false);
      expect(limits.maxDatabases).toBe(1);
      expect(limits.alertingEnabled).toBe(false);
      expect(limits.indexAdvisorEnabled).toBe(false);
      expect(limits.retentionDays).toBe(1);
    });

    it("enforces 2 DB limit and full Pro features during Active Free Trial (server-safe)", () => {
      const limits = getLimits("free", true);
      expect(limits.maxDatabases).toBe(2);
      expect(limits.alertingEnabled).toBe(true);
      expect(limits.indexAdvisorEnabled).toBe(true);
      expect(limits.queryPerformanceEnabled).toBe(true);
      expect(limits.vacuumAdvisorEnabled).toBe(true);
      expect(limits.retentionDays).toBe(30);
    });

    it("enforces 5 DB limit and full Pro features on Paid Pro tier ($39/mo)", () => {
      const limits = getLimits("pro", false);
      expect(limits.maxDatabases).toBe(5);
      expect(limits.alertingEnabled).toBe(true);
      expect(limits.indexAdvisorEnabled).toBe(true);
      expect(limits.queryPerformanceEnabled).toBe(true);
      expect(limits.vacuumAdvisorEnabled).toBe(true);
      expect(limits.retentionDays).toBe(30);
    });

    it("enforces Unlimited DBs and 90-day retention on Team tier ($99/mo)", () => {
      const limits = getLimits("team", false);
      expect(limits.maxDatabases).toBe(Infinity);
      expect(limits.alertingEnabled).toBe(true);
      expect(limits.retentionDays).toBe(90);
    });
  });
});
