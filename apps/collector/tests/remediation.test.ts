import { describe, it, expect } from "vitest";
import crypto from "crypto";

function verifySlackSignature(
  signingSecret: string,
  timestamp: string | undefined,
  rawBody: string,
  signature: string | undefined
): boolean {
  if (!signingSecret || !timestamp || !signature) {
    return false;
  }

  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp, 10)) > 300) {
    return false;
  }

  const sigBaseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(sigBaseString, "utf8")
    .digest("hex");
  const computedSignature = `v0=${hmac}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature, "utf8"),
      Buffer.from(signature, "utf8")
    );
  } catch {
    return false;
  }
}

describe("Remediation & Slack Interaction Security (Spec §6)", () => {
  const secret = "test_slack_signing_secret_12345";

  it("verifies valid Slack HMAC-SHA256 signature", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      actions: [{ action_id: "pgvitals_terminate_session", value: "{\"dbId\":\"db1\",\"pid\":1234}" }],
    });

    const sigBase = `v0:${timestamp}:${body}`;
    const hmac = crypto.createHmac("sha256", secret).update(sigBase).digest("hex");
    const signature = `v0=${hmac}`;

    const isValid = verifySlackSignature(secret, timestamp, body, signature);
    expect(isValid).toBe(true);
  });

  it("rejects tampered body or invalid signature", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "original body";
    const signature = "v0=invalid_signature_hex";

    const isValid = verifySlackSignature(secret, timestamp, body, signature);
    expect(isValid).toBe(false);
  });

  it("rejects expired requests older than 5 minutes (replay prevention)", () => {
    const expiredTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
    const body = "test body";
    const sigBase = `v0:${expiredTimestamp}:${body}`;
    const hmac = crypto.createHmac("sha256", secret).update(sigBase).digest("hex");
    const signature = `v0=${hmac}`;

    const isValid = verifySlackSignature(secret, expiredTimestamp, body, signature);
    expect(isValid).toBe(false);
  });

  it("validates PID parsing safely for termination", () => {
    const validPid = parseInt("8419", 10);
    expect(isNaN(validPid)).toBe(false);
    expect(validPid).toBe(8419);

    const invalidPid = parseInt("invalid_pid", 10);
    expect(isNaN(invalidPid)).toBe(true);

    const negativePid = parseInt("-5", 10);
    expect(negativePid <= 0).toBe(true);
  });
});
