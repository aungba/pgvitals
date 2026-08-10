"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/* ===================================================================
   Onboarding Wizard — Spec §9
   
   7-step guided setup:
   1. Organization name
   2. Paste connection string
   3. Generate read-only role SQL
   4. Validate connection
   5. Capability detection (pg_stat_statements, hypopg, pgbouncer)
   6. First dashboard view
   7. Optional Slack setup
   =================================================================== */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface ValidationResult {
  success: boolean;
  error?: string;
  details?: {
    version: string;
    maxConnections: number;
    databaseName: string;
  };
}

interface CapabilityResult {
  pgStatStatements: boolean;
  hypopg: boolean;
  pgbouncer: boolean;
}

const SETUP_SQL = `-- Run this SQL on your PostgreSQL database as a superuser/admin
-- It creates a read-only monitoring role for PgVitals

-- 1. Create the monitoring role
CREATE ROLE pgvitals_monitor WITH LOGIN PASSWORD 'your_secure_password_here';

-- 2. Grant connect access
GRANT CONNECT ON DATABASE your_database_name TO pgvitals_monitor;

-- 3. Grant read-only access to schema
GRANT USAGE ON SCHEMA public TO pgvitals_monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pgvitals_monitor;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pgvitals_monitor;

-- 4. Grant access to monitoring views (required)
GRANT pg_monitor TO pgvitals_monitor;

-- 5. Optional: Enable pg_stat_statements for query monitoring
-- CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 6. Optional: Enable HypoPG for index simulation
-- CREATE EXTENSION IF NOT EXISTS hypopg;
`;

function StepIndicator({
  currentStep,
  totalSteps,
}: {
  currentStep: number;
  totalSteps: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: "var(--space-xl)",
      }}
    >
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isActive = step === currentStep;
        const isComplete = step < currentStep;
        return (
          <React.Fragment key={step}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.8rem",
                fontWeight: 600,
                background: isComplete
                  ? "var(--signal-healthy)"
                  : isActive
                    ? "var(--brand)"
                    : "var(--surface)",
                color: isComplete || isActive ? "#fff" : "var(--text-muted)",
                border: isActive
                  ? "2px solid var(--brand)"
                  : "2px solid var(--border)",
                transition: "all 0.3s ease",
              }}
            >
              {isComplete ? "✓" : step}
            </div>
            {i < totalSteps - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: isComplete
                    ? "var(--signal-healthy)"
                    : "var(--border)",
                  transition: "background 0.3s ease",
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [orgName, setOrgName] = useState("");
  const [dbName, setDbName] = useState("");
  const [connectionString, setConnectionString] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [sqlCopied, setSqlCopied] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityResult | null>(
    null
  );
  const [detectingCaps, setDetectingCaps] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdDbId, setCreatedDbId] = useState<string | null>(null);
  const [slackUrl, setSlackUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const totalSteps = 7;

  const handleCopySql = useCallback(() => {
    navigator.clipboard.writeText(SETUP_SQL);
    setSqlCopied(true);
    setTimeout(() => setSqlCopied(false), 2000);
  }, []);

  const handleValidate = useCallback(async () => {
    setValidating(true);
    setValidation(null);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/databases/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionString }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setValidation({
          success: true,
          details: data.details,
        });
      } else {
        // Provide specific, actionable error messages
        let errorMsg = data.error || "Connection failed";
        if (errorMsg.includes("timeout") || errorMsg.includes("ETIMEDOUT")) {
          errorMsg = `Connection timed out — check that your database allows inbound connections from our IP range and that port ${connectionString.match(/:(\d+)/)?.[1] || "5432"} is open.`;
        } else if (
          errorMsg.includes("password") ||
          errorMsg.includes("authentication")
        ) {
          errorMsg =
            "Authentication failed — check your username and password in the connection string.";
        } else if (errorMsg.includes("does not exist")) {
          errorMsg =
            "Database does not exist — check the database name in your connection string.";
        } else if (
          errorMsg.includes("SSL") ||
          errorMsg.includes("ssl") ||
          errorMsg.includes("certificate")
        ) {
          errorMsg =
            "SSL connection failed — try adding ?sslmode=require to your connection string, or check your SSL certificate configuration.";
        }
        setValidation({ success: false, error: errorMsg });
      }
    } catch {
      setValidation({
        success: false,
        error:
          "Could not reach the PgVitals API. Ensure the collector service is running.",
      });
    } finally {
      setValidating(false);
    }
  }, [connectionString]);

  const handleDetectCapabilities = useCallback(async () => {
    setDetectingCaps(true);
    try {
      const res = await fetch(`${API_BASE}/api/databases/capabilities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionString }),
      });
      const data = await res.json();
      setCapabilities({
        pgStatStatements: data.pgStatStatements ?? false,
        hypopg: data.hypopg ?? false,
        pgbouncer: data.pgbouncer ?? false,
      });
    } catch {
      setCapabilities({
        pgStatStatements: false,
        hypopg: false,
        pgbouncer: false,
      });
    } finally {
      setDetectingCaps(false);
    }
  }, [connectionString]);

  const handleCreateDatabase = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/databases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: dbName,
          connectionString,
          environment,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setCreatedDbId(data.id);
        setStep(7);
      } else {
        setError(data.error || "Failed to create database");
      }
    } catch {
      setError("Failed to reach the API. Ensure the collector is running.");
    } finally {
      setCreating(false);
    }
  }, [dbName, connectionString, environment]);

  const renderStep = () => {
    switch (step) {
      /* ---- Step 1: Organization ---- */
      case 1:
        return (
          <div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>
              Welcome to PgVitals 🎉
            </h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-lg)", lineHeight: 1.6 }}>
              Let&apos;s set up your PostgreSQL monitoring in under 5 minutes.
              First, name your organization.
            </p>
            <div style={{ marginBottom: "var(--space-md)" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                Organization Name
              </label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. Acme Inc"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-primary)",
                  fontSize: "1rem",
                }}
              />
            </div>
            <button
              onClick={() => setStep(2)}
              disabled={!orgName.trim()}
              className="btn-primary"
              style={{
                padding: "12px 32px",
                fontSize: "1rem",
                borderRadius: "var(--radius-md)",
                background: orgName.trim() ? "var(--brand)" : "var(--surface)",
                color: orgName.trim() ? "#fff" : "var(--text-muted)",
                border: "none",
                cursor: orgName.trim() ? "pointer" : "not-allowed",
                fontWeight: 600,
              }}
            >
              Continue →
            </button>
          </div>
        );

      /* ---- Step 2: Connection String ---- */
      case 2:
        return (
          <div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>
              Connect Your Database
            </h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-lg)", lineHeight: 1.6 }}>
              Paste your PostgreSQL connection string. We&apos;ll use a <strong>read-only</strong> connection — we never write to your database.
            </p>
            <div style={{ marginBottom: "var(--space-md)" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                Database Display Name
              </label>
              <input
                type="text"
                value={dbName}
                onChange={(e) => setDbName(e.target.value)}
                placeholder="e.g. prod-primary"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-primary)",
                  fontSize: "1rem",
                  marginBottom: "var(--space-md)",
                }}
              />
            </div>
            <div style={{ marginBottom: "var(--space-md)" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                Connection String
              </label>
              <input
                type="password"
                value={connectionString}
                onChange={(e) => setConnectionString(e.target.value)}
                placeholder="postgresql://user:password@host:5432/database?sslmode=require"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-primary)",
                  fontSize: "0.9rem",
                  fontFamily: "var(--font-mono)",
                }}
              />
            </div>
            <div style={{ marginBottom: "var(--space-lg)" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                Environment
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {["production", "staging", "development"].map((env) => (
                  <button
                    key={env}
                    onClick={() => setEnvironment(env)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "var(--radius-sm)",
                      border: `1px solid ${environment === env ? "var(--brand)" : "var(--border)"}`,
                      background: environment === env ? "var(--brand-dim)" : "var(--surface)",
                      color: environment === env ? "var(--brand)" : "var(--text-secondary)",
                      cursor: "pointer",
                      fontWeight: 500,
                      fontSize: "0.85rem",
                      textTransform: "capitalize",
                    }}
                  >
                    {env}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep(1)} style={{ padding: "12px 24px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-secondary)", cursor: "pointer" }}>
                ← Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!dbName.trim() || !connectionString.trim()}
                style={{
                  padding: "12px 32px",
                  background: dbName.trim() && connectionString.trim() ? "var(--brand)" : "var(--surface)",
                  color: dbName.trim() && connectionString.trim() ? "#fff" : "var(--text-muted)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  cursor: dbName.trim() && connectionString.trim() ? "pointer" : "not-allowed",
                  fontWeight: 600,
                }}
              >
                Continue →
              </button>
            </div>
          </div>
        );

      /* ---- Step 3: Setup SQL ---- */
      case 3:
        return (
          <div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>
              Set Up Read-Only Access
            </h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-lg)", lineHeight: 1.6 }}>
              Run this SQL on your database to create a dedicated monitoring role. If you&apos;ve already set up a read-only user, you can skip this step.
            </p>
            <div style={{ position: "relative" }}>
              <pre
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--space-md)",
                  overflow: "auto",
                  maxHeight: 300,
                  fontSize: "0.8rem",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                {SETUP_SQL}
              </pre>
              <button
                onClick={handleCopySql}
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  padding: "6px 12px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: sqlCopied ? "var(--signal-healthy)" : "var(--text-secondary)",
                }}
              >
                {sqlCopied ? "✓ Copied!" : "📋 Copy"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: "var(--space-lg)" }}>
              <button onClick={() => setStep(2)} style={{ padding: "12px 24px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-secondary)", cursor: "pointer" }}>
                ← Back
              </button>
              <button
                onClick={() => setStep(4)}
                style={{
                  padding: "12px 32px",
                  background: "var(--brand)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                I&apos;ve run this SQL →
              </button>
            </div>
          </div>
        );

      /* ---- Step 4: Validate Connection ---- */
      case 4:
        return (
          <div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>
              Validate Connection
            </h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-lg)", lineHeight: 1.6 }}>
              Let&apos;s verify we can connect to your database successfully.
            </p>
            <button
              onClick={handleValidate}
              disabled={validating}
              style={{
                padding: "12px 32px",
                background: "var(--brand)",
                color: "#fff",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: validating ? "not-allowed" : "pointer",
                fontWeight: 600,
                opacity: validating ? 0.7 : 1,
                marginBottom: "var(--space-lg)",
              }}
            >
              {validating ? "Testing connection…" : "🔌 Test Connection"}
            </button>
            {validation && (
              <div
                style={{
                  padding: "var(--space-md)",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${validation.success ? "var(--signal-healthy)" : "var(--signal-critical)"}`,
                  background: validation.success ? "var(--signal-healthy-dim)" : "var(--signal-critical-dim)",
                  marginBottom: "var(--space-lg)",
                }}
              >
                {validation.success ? (
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--signal-healthy)", marginBottom: 8 }}>
                      ✅ Connection successful!
                    </div>
                    {validation.details && (
                      <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                        <div>PostgreSQL {validation.details.version}</div>
                        <div>Database: {validation.details.databaseName}</div>
                        <div>Max Connections: {validation.details.maxConnections}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--signal-critical)", marginBottom: 8 }}>
                      ❌ Connection failed
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                      {validation.error}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep(3)} style={{ padding: "12px 24px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-secondary)", cursor: "pointer" }}>
                ← Back
              </button>
              {validation?.success && (
                <button
                  onClick={() => { setStep(5); handleDetectCapabilities(); }}
                  style={{
                    padding: "12px 32px",
                    background: "var(--brand)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Continue →
                </button>
              )}
            </div>
          </div>
        );

      /* ---- Step 5: Capability Detection ---- */
      case 5:
        return (
          <div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>
              Capability Detection
            </h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-lg)", lineHeight: 1.6 }}>
              We&apos;re checking which optional extensions are available on your database.
            </p>
            {detectingCaps ? (
              <div style={{ textAlign: "center", padding: "var(--space-xl)", color: "var(--text-muted)" }}>
                Detecting capabilities…
              </div>
            ) : capabilities ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: "var(--space-lg)" }}>
                {[
                  { key: "pgStatStatements", name: "pg_stat_statements", desc: "Query performance monitoring — track slow queries, N+1 patterns, and optimization suggestions", enableSql: "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;" },
                  { key: "hypopg", name: "HypoPG", desc: "Index simulation — test hypothetical indexes without writing to disk", enableSql: "CREATE EXTENSION IF NOT EXISTS hypopg;" },
                  { key: "pgbouncer", name: "PgBouncer", desc: "Connection pool monitoring — track pool exhaustion and wait times", enableSql: null },
                ].map((cap) => {
                  const isEnabled = capabilities[cap.key as keyof CapabilityResult];
                  return (
                    <div
                      key={cap.key}
                      style={{
                        padding: "var(--space-md)",
                        borderRadius: "var(--radius-md)",
                        border: `1px solid ${isEnabled ? "var(--signal-healthy)" : "var(--border)"}`,
                        background: isEnabled ? "var(--signal-healthy-dim)" : "var(--surface)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: "1.1rem" }}>{isEnabled ? "✅" : "⚠️"}</span>
                        <span style={{ fontWeight: 600 }}>{cap.name}</span>
                        <span style={{
                          fontSize: "0.7rem",
                          padding: "2px 8px",
                          borderRadius: "var(--radius-sm)",
                          background: isEnabled ? "var(--signal-healthy)" : "var(--signal-warning)",
                          color: "#fff",
                          fontWeight: 600,
                        }}>
                          {isEnabled ? "ENABLED" : "NOT FOUND"}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: isEnabled ? 0 : 8 }}>
                        {cap.desc}
                      </div>
                      {!isEnabled && cap.enableSql && (
                        <code style={{
                          display: "block",
                          fontSize: "0.8rem",
                          fontFamily: "var(--font-mono)",
                          padding: "8px 12px",
                          background: "var(--bg)",
                          borderRadius: "var(--radius-sm)",
                          color: "var(--text-muted)",
                        }}>
                          {cap.enableSql}
                        </code>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep(4)} style={{ padding: "12px 24px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-secondary)", cursor: "pointer" }}>
                ← Back
              </button>
              <button
                onClick={handleCreateDatabase}
                disabled={creating}
                style={{
                  padding: "12px 32px",
                  background: "var(--brand)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  cursor: creating ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  opacity: creating ? 0.7 : 1,
                }}
              >
                {creating ? "Creating…" : "Create Database & Start Monitoring →"}
              </button>
            </div>
            {error && (
              <div style={{ marginTop: "var(--space-md)", padding: "var(--space-md)", background: "var(--signal-critical-dim)", border: "1px solid var(--signal-critical)", borderRadius: "var(--radius-md)", color: "var(--signal-critical)", fontSize: "0.85rem" }}>
                {error}
              </div>
            )}
          </div>
        );

      /* ---- Step 6: First Dashboard (redirect) ---- */
      case 6:
        return (
          <div style={{ textAlign: "center", padding: "var(--space-2xl)" }}>
            <div style={{ fontSize: "3rem", marginBottom: "var(--space-md)" }}>🚀</div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>
              All Set!
            </h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-lg)" }}>
              Redirecting to your dashboard…
            </p>
          </div>
        );

      /* ---- Step 7: Optional Slack ---- */
      case 7:
        return (
          <div>
            <div style={{ textAlign: "center", marginBottom: "var(--space-xl)" }}>
              <div style={{ fontSize: "3rem", marginBottom: "var(--space-md)" }}>🎉</div>
              <h2 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>
                Database Connected Successfully!
              </h2>
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
                Your first data collection is running now. Want to set up Slack alerts?
              </p>
            </div>
            <div style={{ marginBottom: "var(--space-lg)" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                Slack Incoming Webhook URL (optional)
              </label>
              <input
                type="url"
                value={slackUrl}
                onChange={(e) => setSlackUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-primary)",
                  fontSize: "0.9rem",
                  fontFamily: "var(--font-mono)",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={() => router.push(createdDbId ? `/databases/${createdDbId}` : "/")}
                style={{
                  padding: "12px 32px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  fontWeight: 500,
                }}
              >
                Skip for now
              </button>
              <button
                onClick={() => router.push(createdDbId ? `/databases/${createdDbId}/alerts` : "/")}
                style={{
                  padding: "12px 32px",
                  background: "var(--brand)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {slackUrl ? "Save & View Dashboard →" : "Go to Dashboard →"}
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      style={{
        maxWidth: 680,
        margin: "0 auto",
        padding: "var(--space-2xl) var(--space-lg)",
      }}
    >
      <div style={{ marginBottom: "var(--space-lg)" }}>
        <Link
          href="/"
          style={{
            color: "var(--text-muted)",
            textDecoration: "none",
            fontSize: "0.85rem",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          ← Back to Dashboard
        </Link>
      </div>

      <StepIndicator currentStep={step} totalSteps={totalSteps} />

      <div className="glass-card-static" style={{ padding: "var(--space-xl)" }}>
        {renderStep()}
      </div>
    </div>
  );
}
