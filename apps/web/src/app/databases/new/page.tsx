"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createDatabase } from "../../lib/api";

/* ===================================================================
   Add Database — Form to register a new database for monitoring
   =================================================================== */

export default function AddDatabasePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [connectionString, setConnectionString] = useState("");
  const [environment, setEnvironment] = useState<
    "production" | "staging" | "development"
  >("development");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await createDatabase({ name, connectionString, environment });
      setSuccess(true);
      setTimeout(() => router.push("/"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add database");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header">
        <h1>Add Database</h1>
        <p>Register a PostgreSQL database for monitoring</p>
      </div>

      {success && (
        <div className="alert alert-success">
          <span>✓</span>
          <span>Database added successfully! Redirecting…</span>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <div className="form-container">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="db-name">
              Database Name
            </label>
            <input
              id="db-name"
              className="form-input"
              type="text"
              placeholder="e.g. production-primary"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              disabled={submitting || success}
            />
            <div className="form-hint">
              A friendly name to identify this database
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="db-connection">
              Connection String
            </label>
            <input
              id="db-connection"
              className="form-input"
              type="text"
              placeholder="postgresql://user:password@host:5432/dbname"
              value={connectionString}
              onChange={(e) => setConnectionString(e.target.value)}
              required
              disabled={submitting || success}
              style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}
            />
            <div className="form-hint">
              Standard PostgreSQL connection URI. Credentials are stored
              securely.
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="db-env">
              Environment
            </label>
            <select
              id="db-env"
              className="form-select"
              value={environment}
              onChange={(e) =>
                setEnvironment(
                  e.target.value as "production" | "staging" | "development",
                )
              }
              disabled={submitting || success}
            >
              <option value="development">Development</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </div>

          <div
            style={{
              display: "flex",
              gap: "var(--space-md)",
              marginTop: "var(--space-xl)",
            }}
          >
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting || success || !name || !connectionString}
            >
              {submitting ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16 }} />
                  Adding…
                </>
              ) : (
                "Add Database"
              )}
            </button>
            <Link href="/" className="btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
