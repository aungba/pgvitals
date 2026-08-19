import { describe, it, expect } from "vitest";
import { evaluateIoStall } from "../src/collector/rules/io-stall-rule.js";

describe("I/O Stall Rule Evaluator (Spec §4.3)", () => {
  it("returns null when I/O time percentage is below 45%", () => {
    const result = evaluateIoStall({
      queryid: 12345,
      total_exec_time: 5000,
      blk_read_time: 1000,
      blk_write_time: 500,
      io_time_percentage: 30.0,
    });
    expect(result).toBeNull();
  });

  it("returns null when total_exec_time is below 1500ms even if I/O percent is high", () => {
    const result = evaluateIoStall({
      queryid: 12345,
      total_exec_time: 800,
      blk_read_time: 500,
      blk_write_time: 200,
      io_time_percentage: 87.5,
    });
    expect(result).toBeNull();
  });

  it("triggers a warning for moderate I/O stall", () => {
    const result = evaluateIoStall({
      queryid: 998877,
      total_exec_time: 2500,
      blk_read_time: 1200,
      blk_write_time: 300,
      io_time_percentage: 60.0,
    });

    expect(result).not.toBeNull();
    expect(result?.severity).toBe("warning");
    expect(result?.ruleId).toBe("io_stall_bottleneck");
    expect(result?.title).toBe("Disk I/O Stall Dominated Execution");
    expect(result?.message).toContain("60.0%");
  });

  it("triggers critical severity for severe I/O stall (>=75% or total_exec_time > 10000ms)", () => {
    const result = evaluateIoStall({
      queryid: 998877,
      total_exec_time: 12000,
      blk_read_time: 9000,
      blk_write_time: 1000,
      io_time_percentage: 83.3,
    });

    expect(result).not.toBeNull();
    expect(result?.severity).toBe("critical");
  });
});
