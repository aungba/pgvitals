import { describe, it, expect } from "vitest";
import {
  parseMemoryToMb,
  formatMb,
  computeOptimalSettings,
  generateGucReport,
  type HardwareProfile,
  type LiveSetting,
} from "../src/collector/guc-advisor.js";

describe("GUC Advisor (PGTune Engine)", () => {
  describe("parseMemoryToMb", () => {
    it("parses strings with units accurately", () => {
      expect(parseMemoryToMb("16GB")).toBe(16 * 1024);
      expect(parseMemoryToMb("512MB")).toBe(512);
      expect(parseMemoryToMb("8192kB")).toBe(8);
      expect(parseMemoryToMb("1024", "8kB")).toBe(8);
    });

    it("handles zero or invalid input gracefully", () => {
      expect(parseMemoryToMb("")).toBe(0);
      expect(parseMemoryToMb("invalid")).toBe(0);
    });
  });

  describe("formatMb", () => {
    it("formats MB to appropriate human-readable PG units", () => {
      expect(formatMb(4096)).toBe("4GB");
      expect(formatMb(256)).toBe("256MB");
      expect(formatMb(0.5)).toBe("512kB");
    });
  });

  describe("computeOptimalSettings", () => {
    it("computes standard recommendations for a 16GB Web application", () => {
      const profile: HardwareProfile = {
        totalRamGb: 16,
        cpuCores: 8,
        diskType: "ssd",
        workloadType: "web",
        maxConnections: 100,
      };

      const settings = computeOptimalSettings(profile);

      // 25% of 16GB = 4GB
      expect(settings.shared_buffers).toBe("4GB");
      // 75% of 16GB = 12GB
      expect(settings.effective_cache_size).toBe("12GB");
      // SSD settings
      expect(settings.random_page_cost).toBe("1.1");
      expect(settings.effective_io_concurrency).toBe("200");
      // Parallelism
      expect(settings.max_worker_processes).toBe("8");
      expect(settings.max_parallel_workers).toBe("8");
      expect(settings.max_parallel_workers_per_gather).toBe("4");
      // Diagnostics
      expect(settings.track_io_timing).toBe("on");
      expect(settings.checkpoint_completion_target).toBe("0.9");
    });

    it("computes distinct recommendations for HDD vs SSD", () => {
      const hddProfile: HardwareProfile = {
        totalRamGb: 8,
        cpuCores: 4,
        diskType: "hdd",
        workloadType: "oltp",
      };
      const ssdProfile: HardwareProfile = {
        totalRamGb: 8,
        cpuCores: 4,
        diskType: "ssd",
        workloadType: "oltp",
      };

      const hddSettings = computeOptimalSettings(hddProfile);
      const ssdSettings = computeOptimalSettings(ssdProfile);

      expect(hddSettings.random_page_cost).toBe("4.0");
      expect(ssdSettings.random_page_cost).toBe("1.1");
      expect(hddSettings.effective_io_concurrency).toBe("2");
      expect(ssdSettings.effective_io_concurrency).toBe("200");
    });

    it("allocates more shared_buffers and work_mem for Data Warehouse workloads", () => {
      const dwProfile: HardwareProfile = {
        totalRamGb: 32,
        cpuCores: 16,
        diskType: "ssd",
        workloadType: "dw",
        maxConnections: 30,
      };

      const dwSettings = computeOptimalSettings(dwProfile);
      // DW gets up to 40% shared_buffers
      expect(dwSettings.shared_buffers).toBe("12.8GB");
      expect(dwSettings.checkpoint_timeout).toBe("30min");
      expect(dwSettings.default_statistics_target).toBe("500");
    });
  });

  describe("generateGucReport", () => {
    it("flags default 128MB shared_buffers as critical on large machines", () => {
      const profile: HardwareProfile = {
        totalRamGb: 16,
        cpuCores: 8,
        diskType: "ssd",
        workloadType: "web",
      };

      const liveSettings: LiveSetting[] = [
        {
          name: "shared_buffers",
          setting: "16384", // 16384 * 8kB = 128MB
          unit: "8kB",
          category: "Resource Usage / Memory",
          context: "postmaster",
          bootVal: "1024",
          resetVal: "16384",
          shortDesc: "Sets the number of shared memory buffers used by the server.",
        },
        {
          name: "track_io_timing",
          setting: "off",
          unit: null,
          category: "Statistics / Query and Index Statistics Collector",
          context: "sighup",
          bootVal: "off",
          resetVal: "off",
          shortDesc: "Collects timing statistics for database I/O activity.",
        },
      ];

      const report = generateGucReport(profile, liveSettings);

      const sharedRec = report.recommendations.find((r) => r.name === "shared_buffers");
      expect(sharedRec).toBeDefined();
      expect(sharedRec?.status).toBe("critical");
      expect(sharedRec?.restartRequired).toBe(true);

      const ioRec = report.recommendations.find((r) => r.name === "track_io_timing");
      expect(ioRec?.status).toBe("warning");
      expect(ioRec?.restartRequired).toBe(false);

      expect(report.summary.criticalCount).toBeGreaterThanOrEqual(1);
      expect(report.alterSystemSql).toContain("ALTER SYSTEM SET shared_buffers = '4GB';");
      expect(report.alterSystemSql).toContain("SELECT pg_reload_conf();");
    });
  });
});
