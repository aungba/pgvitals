"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import ThemeToggle from "./ThemeToggle";
import { LogoIcon } from "./Logo";

/* ===================================================================
   PG Vitals — Public Marketing Landing Page
   High-converting, developer-focused, rich animations & interactive previews
   =================================================================== */

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function LandingPage() {
  const { isSignedIn } = useAuth();
  const [activeTab, setActiveTab] = useState<"connections" | "queries" | "bloat" | "alerts">("connections");
  const [isAnnual, setIsAnnual] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Live metric fluctuation simulation for the interactive hero gauge
  const [simMetrics, setSimMetrics] = useState({
    connections: 68,
    idleTxn: 4,
    qps: 1420,
    p95Latency: "14.2ms",
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setSimMetrics((prev) => ({
        connections: Math.min(95, Math.max(45, prev.connections + Math.floor(Math.random() * 7) - 3)),
        idleTxn: Math.min(8, Math.max(1, prev.idleTxn + (Math.random() > 0.6 ? (Math.random() > 0.5 ? 1 : -1) : 0))),
        qps: Math.min(2200, Math.max(900, prev.qps + Math.floor(Math.random() * 120) - 60)),
        p95Latency: `${(12 + Math.random() * 4).toFixed(1)}ms`,
      }));
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const setupSql = `-- 1. Create a secure read-only monitoring role
CREATE ROLE pgvitals_monitor WITH LOGIN PASSWORD 'your_strong_password';

-- 2. Grant system statistic inspection privileges
GRANT pg_read_all_stats TO pgvitals_monitor;

-- 3. Enable query performance tracking
GRANT SELECT ON pg_stat_statements TO pgvitals_monitor;`;

  const handleCopySql = () => {
    navigator.clipboard.writeText(setupSql);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const faqs = [
    {
      q: "Does PG Vitals require installing a heavyweight agent on our server?",
      a: "No. PG Vitals is agentless. You simply create a read-only PostgreSQL role (`pg_read_all_stats`) and provide the connection string. Our secure cloud collector polls system catalog views every 10–30 seconds with virtually zero CPU overhead (<0.5%).",
    },
    {
      q: "Is my customer database data safe?",
      a: "Yes, 100%. PG Vitals connects with strict read-only permissions and only inspects Postgres system tables (`pg_stat_activity`, `pg_stat_statements`, `pg_stat_user_tables`). We enforce query sanitization at the driver level to prevent any write or schema changes, and we NEVER read customer row data.",
    },
    {
      q: "Which PostgreSQL providers and versions are supported?",
      a: "PG Vitals works seamlessly with any PostgreSQL 12+ database, including AWS RDS / Aurora, Supabase, Neon, GCP Cloud SQL, Azure Database for PostgreSQL, Crunchy Data, Railway, Heroku, and self-hosted instances.",
    },
    {
      q: "How does root-cause alerting work?",
      a: "Unlike generic APMs that just notify you when CPU is high, PG Vitals correlates connection spikes with specific client IP addresses, offending session PIDs, and `idle in transaction` queries. When an alert fires to Slack or email, it tells you exactly which service and query caused the spike.",
    },
    {
      q: "What if our organization needs more than 20 databases?",
      a: "You can add extra databases to the Team plan for just $10/mo per database, or contact us for Enterprise custom quotas, dedicated VPC collectors, and custom data retention.",
    },
  ];

  return (
    <div className="landing-root">
      {/* Background Decorative Glow Blobs */}
      <div className="landing-glow-blob landing-glow-1" />
      <div className="landing-glow-blob landing-glow-2" />

      {/* Top Navigation Bar */}
      <header className="landing-nav">
        <div className="landing-nav-container">
          <Link href="/" className="landing-brand">
            <LogoIcon size={36} />
            <span className="landing-brand-title">PG Vitals</span>
          </Link>

          <nav className="landing-nav-links">
            <a href="#features" className="landing-nav-link">Features</a>
            <a href="#preview" className="landing-nav-link">Live Preview</a>
            <a href="#security" className="landing-nav-link">Security</a>
            <a href="#pricing" className="landing-nav-link">Pricing</a>
            <a href="#faq" className="landing-nav-link">FAQ</a>
          </nav>

          <div className="landing-nav-actions">
            <ThemeToggle />
            {isSignedIn ? (
              <Link href="/" className="btn-primary landing-cta-btn">
                Open Dashboard →
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className="landing-login-btn">
                  Sign In
                </Link>
                <Link href="/sign-up" className="btn-primary landing-cta-btn">
                  Start Free
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="landing-hero">
        <div className="landing-container">
          <div className="landing-hero-badge animate-fade-in">
            <span className="pulse-indicator" />
            <span>Agentless PostgreSQL Observability & Diagnostics</span>
          </div>

          <h1 className="landing-hero-title animate-fade-in-up">
            Never Let a Rogue Query <br />
            <span className="gradient-text">Starve Your Database Again.</span>
          </h1>

          <p className="landing-hero-subtitle animate-fade-in-up">
            Real-time connection monitoring, missing index detection, bloat diagnostics, and
            actionable root-cause alerts for PostgreSQL. Setup in under 60 seconds with 100% read-only access.
          </p>

          <div className="landing-hero-actions animate-fade-in-up">
            <Link href={isSignedIn ? "/" : "/sign-up"} className="btn-primary landing-hero-primary-btn">
              <span>Start Free Monitoring</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <a href="#preview" className="btn-secondary landing-hero-secondary-btn">
              <span>Explore Interactive Live Demo</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </a>
          </div>

          <div className="landing-hero-trust animate-fade-in">
            <span>Seamless compatibility with</span>
            <div className="landing-trust-tags">
              <span className="trust-tag">AWS RDS</span>
              <span className="trust-tag">Supabase</span>
              <span className="trust-tag">Neon</span>
              <span className="trust-tag">GCP Cloud SQL</span>
              <span className="trust-tag">Crunchy Bridge</span>
              <span className="trust-tag">Self-Hosted</span>
            </div>
          </div>
        </div>
      </section>

      {/* Live Interactive Preview / Mock Dashboard */}
      <section id="preview" className="landing-section landing-preview-section">
        <div className="landing-container">
          <div className="section-header-center">
            <span className="section-eyebrow">Interactive Telemetry Preview</span>
            <h2>Real-Time Diagnostics at a Glance</h2>
            <p>Experience how PG Vitals detects bottlenecks before they impact your users.</p>
          </div>

          <div className="landing-preview-window glass-card animate-glow">
            {/* Window Top Bar */}
            <div className="preview-window-bar">
              <div className="preview-window-dots">
                <span className="dot dot-red" />
                <span className="dot dot-yellow" />
                <span className="dot dot-green" />
              </div>
              <div className="preview-window-title">
                <span className="preview-db-icon">🐘</span> production-primary.internal (PostgreSQL 16.2)
              </div>
              <div className="preview-live-badge">
                <span className="live-dot" /> LIVE 10s POLLING
              </div>
            </div>

            {/* Live Metrics Row */}
            <div className="preview-metrics-grid">
              <div className="preview-metric-card">
                <div className="preview-metric-label">Connection Utilization</div>
                <div className="preview-gauge-wrap">
                  <div className="preview-gauge-number">{simMetrics.connections}%</div>
                  <div className="preview-gauge-sub">{simMetrics.connections} / 100 max_conn</div>
                </div>
                <div className="preview-progress-bar">
                  <div
                    className="preview-progress-fill"
                    style={{
                      width: `${simMetrics.connections}%`,
                      backgroundColor: simMetrics.connections > 80 ? "var(--signal-critical)" : "var(--brand)",
                    }}
                  />
                </div>
              </div>

              <div className="preview-metric-card">
                <div className="preview-metric-label">Idle In Transaction</div>
                <div className="preview-metric-value" style={{ color: simMetrics.idleTxn > 4 ? "var(--signal-warning)" : "var(--signal-healthy)" }}>
                  {simMetrics.idleTxn} <span className="preview-metric-unit">pids</span>
                </div>
                <div className="preview-metric-hint">
                  {simMetrics.idleTxn > 4 ? "⚠️ Risk of table lock contention" : "✓ Within healthy thresholds"}
                </div>
              </div>

              <div className="preview-metric-card">
                <div className="preview-metric-label">Query Throughput</div>
                <div className="preview-metric-value">
                  {simMetrics.qps.toLocaleString()} <span className="preview-metric-unit">qps</span>
                </div>
                <div className="preview-metric-hint">P95 Latency: {simMetrics.p95Latency}</div>
              </div>

              <div className="preview-metric-card">
                <div className="preview-metric-label">Autovacuum Health</div>
                <div className="preview-metric-value" style={{ color: "var(--signal-healthy)" }}>
                  98.4% <span className="preview-metric-unit">healthy</span>
                </div>
                <div className="preview-metric-hint">0 tables near wraparound limit</div>
              </div>
            </div>

            {/* Root-Cause Alert Card */}
            <div className="preview-alert-banner">
              <div className="preview-alert-header">
                <span className="alert-badge alert-badge-warning">WARNING</span>
                <strong>High Idle-in-Transaction Duration Detected</strong>
                <span className="preview-alert-time">Just now</span>
              </div>
              <div className="preview-alert-body">
                <p>
                  PID <code>28491</code> from <code>10.0.4.12 (order-service)</code> has been holding an open transaction for <strong>4m 12s</strong> on table <code>orders</code>.
                </p>
                <div className="preview-alert-hint">
                  💡 <strong>Root Cause:</strong> Uncommitted transaction following payment gateway timeout. Recommended action: <code>SELECT pg_terminate_backend(28491);</code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Deep Dive with Interactive Tabs */}
      <section id="features" className="landing-section">
        <div className="landing-container">
          <div className="section-header-center">
            <span className="section-eyebrow">Deep Diagnostic Engine</span>
            <h2>Everything You Need to Maintain 99.99% DB Health</h2>
            <p>From connection starvation alerts to automated index suggestions, solve performance issues in seconds.</p>
          </div>

          {/* Interactive Feature Tabs */}
          <div className="landing-tab-bar">
            <button
              className={`landing-tab-btn ${activeTab === "connections" ? "active" : ""}`}
              onClick={() => setActiveTab("connections")}
            >
              📊 Connection & Pool Health
            </button>
            <button
              className={`landing-tab-btn ${activeTab === "queries" ? "active" : ""}`}
              onClick={() => setActiveTab("queries")}
            >
              ⚡ Query Performance & Missing Indexes
            </button>
            <button
              className={`landing-tab-btn ${activeTab === "bloat" ? "active" : ""}`}
              onClick={() => setActiveTab("bloat")}
            >
              🧹 Bloat & Autovacuum Advisor
            </button>
            <button
              className={`landing-tab-btn ${activeTab === "alerts" ? "active" : ""}`}
              onClick={() => setActiveTab("alerts")}
            >
              🔔 Root-Cause Alerting (Slack)
            </button>
          </div>

          {/* Tab Content Display */}
          <div className="landing-tab-content glass-card">
            {activeTab === "connections" && (
              <div className="tab-pane animate-fade-in">
                <div className="tab-pane-text">
                  <h3>Stop Connection Exhaustion in its Tracks</h3>
                  <p>
                    Postgres max_connections saturation is the #1 cause of sudden application downtime.
                    PG Vitals monitors active sessions, pooler utilization (PgBouncer/Supavisor), and
                    flags connection leaks before backend workers crash.
                  </p>
                  <ul className="tab-feature-list">
                    <li>✓ Track active, idle, and idle-in-transaction connection breakdowns</li>
                    <li>✓ Pinpoint client IPs, service names, and blocking transaction locks</li>
                    <li>✓ Configurable saturation thresholds with zero-latency warnings</li>
                  </ul>
                </div>
                <div className="tab-pane-visual">
                  <div className="tab-mock-table">
                    <div className="tab-table-header">Active Session Breakdown (Top PIDs)</div>
                    <div className="tab-table-row">
                      <span className="pid-badge">PID 1042</span>
                      <span className="tab-table-query">SELECT * FROM users WHERE email = $1 FOR UPDATE</span>
                      <span className="tab-table-state state-warning">idle in txn (3m)</span>
                    </div>
                    <div className="tab-table-row">
                      <span className="pid-badge">PID 1098</span>
                      <span className="tab-table-query">UPDATE accounts SET balance = balance - 50...</span>
                      <span className="tab-table-state state-active">active (120ms)</span>
                    </div>
                    <div className="tab-table-row">
                      <span className="pid-badge">PID 1120</span>
                      <span className="tab-table-query">SELECT COUNT(*) FROM audit_logs WHERE created...</span>
                      <span className="tab-table-state state-active">active (450ms)</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "queries" && (
              <div className="tab-pane animate-fade-in">
                <div className="tab-pane-text">
                  <h3>Automated Index Suggestions & Plan Regressions</h3>
                  <p>
                    Identify slow queries and sequential scans draining your disk I/O.
                    PG Vitals automatically generates the exact <code>CREATE INDEX CONCURRENTLY</code> statements
                    needed to restore microsecond latencies.
                  </p>
                  <ul className="tab-feature-list">
                    <li>✓ Automatic sequential scan ratio tracking across all tables</li>
                    <li>✓ Copy-paste ready DDL with estimated performance impact</li>
                    <li>✓ Catch execution plan changes before they cause production latency spikes</li>
                  </ul>
                </div>
                <div className="tab-pane-visual">
                  <div className="tab-code-block">
                    <div className="tab-code-header">
                      <span>Index Recommendation for <code>customers</code></span>
                      <span className="badge-gain">+88% Estimated Speedup</span>
                    </div>
                    <pre>
                      <code>{`-- Recommended for table: customers (92% Sequential Scans)
CREATE INDEX CONCURRENTLY idx_customers_org_status 
ON customers (org_id, status) 
WHERE deleted_at IS NULL;`}</code>
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "bloat" && (
              <div className="tab-pane animate-fade-in">
                <div className="tab-pane-text">
                  <h3>Eliminate Table Bloat & Prevent ID Wraparound</h3>
                  <p>
                    Dead tuples degrade cache efficiency and slow down query execution.
                    PG Vitals monitors table and index bloat, tracks autovacuum freeze progress, and alerts
                    you well before reaching critical transaction ID wraparound limits.
                  </p>
                  <ul className="tab-feature-list">
                    <li>✓ Accurate dead tuple ratio estimation without locking tables</li>
                    <li>✓ Autovacuum starvation detection and tuning recommendations</li>
                    <li>✓ Multi-level TXID wraparound countdown alerts</li>
                  </ul>
                </div>
                <div className="tab-pane-visual">
                  <div className="tab-bloat-card">
                    <div className="bloat-stat-row">
                      <span>Table: <code>events_stream</code></span>
                      <span className="bloat-badge-critical">42% Dead Tuples (3.2 GB Bloat)</span>
                    </div>
                    <div className="bloat-metric-bar">
                      <div className="bloat-fill-live" style={{ width: "58%" }} title="Live Tuples: 58%" />
                      <div className="bloat-fill-dead" style={{ width: "42%" }} title="Dead Tuples: 42%" />
                    </div>
                    <div className="bloat-rec-note">
                      💡 Last autovacuum was 14 days ago. Recommend lowering <code>autovacuum_vacuum_scale_factor</code> to 0.05.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "alerts" && (
              <div className="tab-pane animate-fade-in">
                <div className="tab-pane-text">
                  <h3>Root-Cause Alerting That Developers Actually Love</h3>
                  <p>
                    Never wake up to useless "High CPU" alerts again.
                    Every PG Vitals notification includes the offending query fingerprint, the client IP address,
                    and actionable guidance on how to fix it immediately.
                  </p>
                  <ul className="tab-feature-list">
                    <li>✓ Slack Webhooks, Discord, and Email alert integrations</li>
                    <li>✓ Root-cause hints generated dynamically from live sessions</li>
                    <li>✓ Intelligent cooldowns to prevent notification storms</li>
                  </ul>
                </div>
                <div className="tab-pane-visual">
                  <div className="slack-preview-card">
                    <div className="slack-card-header">
                      <div className="slack-avatar">PG</div>
                      <div>
                        <strong>PG Vitals Bot</strong> <span className="slack-app-badge">APP</span>
                        <span className="slack-time">11:45 AM</span>
                      </div>
                    </div>
                    <div className="slack-card-content">
                      <div className="slack-alert-title">🚨 CRITICAL: Connection Pool Exhaustion</div>
                      <p>Database: <strong>prod-api-db</strong> | Current: <strong>96 / 100 conns</strong></p>
                      <div className="slack-quote">
                        <strong>Root Cause Hint:</strong> 18 uncommitted transactions originating from <code>celery-worker-7</code> running query <code>SELECT ... FOR UPDATE</code>.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 60-Second Setup Terminal */}
      <section id="how-it-works" className="landing-section">
        <div className="landing-container">
          <div className="section-header-center">
            <span className="section-eyebrow">Zero Friction Onboarding</span>
            <h2>Up and Running in 60 Seconds</h2>
            <p>No software agents to compile, no complex daemon services. Run 3 lines of SQL and you are done.</p>
          </div>

          <div className="terminal-container glass-card">
            <div className="terminal-header">
              <div className="terminal-dots">
                <span className="dot dot-red" />
                <span className="dot dot-yellow" />
                <span className="dot dot-green" />
              </div>
              <span className="terminal-title">psql -d my_production_database</span>
              <button className="copy-btn" onClick={handleCopySql} data-copied={copiedCode}>
                {copiedCode ? "✓ Copied!" : "📋 Copy SQL"}
              </button>
            </div>
            <pre className="terminal-code">
              <code>{setupSql}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Security & Architecture */}
      <section id="security" className="landing-section landing-security-section">
        <div className="landing-container">
          <div className="section-header-center">
            <span className="section-eyebrow">Enterprise-Grade Security</span>
            <h2>Engineered to Satisfy the Most Strict DBAs</h2>
            <p>Your database credentials and internal row data are safeguarded with defense-in-depth security.</p>
          </div>

          <div className="security-grid">
            <div className="security-card glass-card">
              <div className="security-icon">🔒</div>
              <h3>100% Read-Only</h3>
              <p>PG Vitals only queries PostgreSQL system statistics. We reject any write, update, or schema change statements at the driver level.</p>
            </div>

            <div className="security-card glass-card">
              <div className="security-icon">🛡️</div>
              <h3>Encrypted at Rest</h3>
              <p>All connection strings and credentials are encrypted using military-grade AES-256 with KMS-managed rotating keys.</p>
            </div>

            <div className="security-card glass-card">
              <div className="security-icon">🚫</div>
              <h3>Zero Customer Data Stored</h3>
              <p>We never read, replicate, or store your customer row records. We only capture diagnostic metadata.</p>
            </div>

            <div className="security-card glass-card">
              <div className="security-icon">⚡</div>
              <h3>&lt;0.5% Polling Overhead</h3>
              <p>Our polling queries are lightweight, indexed, and non-blocking, ensuring zero impact on your production database throughput.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="landing-section">
        <div className="landing-container">
          <div className="section-header-center">
            <span className="section-eyebrow">Fair & Transparent Pricing</span>
            <h2>Simple Plans for Teams of All Sizes</h2>
            <p>Start free today. Scale as your architecture grows.</p>

            {/* Monthly / Annual Toggle */}
            <div className="pricing-toggle-wrap">
              <span className={!isAnnual ? "pricing-toggle-active" : ""}>Monthly</span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={isAnnual}
                  onChange={(e) => setIsAnnual(e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
              <span className={isAnnual ? "pricing-toggle-active" : ""}>
                Annual <span className="discount-badge">Save 20%</span>
              </span>
            </div>
          </div>

          <div className="landing-pricing-grid">
            {/* Free Plan */}
            <div className="glass-card landing-pricing-card">
              <div className="landing-plan-badge">Hobby / Starter</div>
              <h3 className="landing-plan-title">Free</h3>
              <div className="landing-plan-price">
                <span className="price-num">$0</span>
                <span className="price-period">/ forever</span>
              </div>
              <p className="landing-plan-desc">Essential health monitoring for single-database hobby or side projects.</p>

              <ul className="landing-plan-features">
                <li><span className="check-icon">✓</span> <strong>1 Monitored Database</strong></li>
                <li><span className="check-icon">✓</span> <strong>1 User Seat</strong></li>
                <li><span className="check-icon">✓</span> 24-Hour Telemetry Retention</li>
                <li><span className="check-icon">✓</span> Real-Time Connection Gauges</li>
                <li><span className="cross-icon">—</span> <span className="feature-disabled">Slack Alerting</span></li>
                <li><span className="cross-icon">—</span> <span className="feature-disabled">Index & Vacuum Advisors</span></li>
              </ul>

              <Link href="/sign-up" className="btn-secondary landing-plan-btn">
                Start Free (1 DB)
              </Link>
            </div>

            {/* Pro Plan (Highlighted) */}
            <div className="glass-card landing-pricing-card landing-pricing-featured">
              <div className="landing-plan-popular-tag">MOST POPULAR</div>
              <div className="landing-plan-badge">Early Startups</div>
              <h3 className="landing-plan-title">Pro</h3>
              <div className="landing-plan-price">
                <span className="price-num">{isAnnual ? "$31" : "$39"}</span>
                <span className="price-period">/ month</span>
              </div>
              <p className="landing-plan-desc">Comprehensive diagnostics & alerting for fast-moving startups and apps.</p>

              <ul className="landing-plan-features">
                <li><span className="check-icon">✓</span> <strong>Up to 5 Monitored Databases</strong></li>
                <li><span className="check-icon">✓</span> <strong>3 Team Member Seats</strong></li>
                <li><span className="check-icon">✓</span> <strong>30-Day Data Retention</strong></li>
                <li><span className="check-icon">✓</span> Automated Index Advisor</li>
                <li><span className="check-icon">✓</span> Vacuum & Bloat Health Advisor</li>
                <li><span className="check-icon">✓</span> Real-Time Slack & Email Alerts</li>
              </ul>

              <Link href="/sign-up" className="btn-primary landing-plan-btn">
                Start 14-Day Free Trial
              </Link>
            </div>

            {/* Team Plan */}
            <div className="glass-card landing-pricing-card">
              <div className="landing-plan-badge">Growth & Scale</div>
              <h3 className="landing-plan-title">Team</h3>
              <div className="landing-plan-price">
                <span className="price-num">{isAnnual ? "$119" : "$149"}</span>
                <span className="price-period">/ month</span>
              </div>
              <p className="landing-plan-desc">For engineering organizations managing multiple microservices and clusters.</p>

              <ul className="landing-plan-features">
                <li><span className="check-icon">✓</span> <strong>Up to 20 Monitored Databases</strong></li>
                <li><span className="check-icon">✓</span> <strong>Unlimited Team Members</strong></li>
                <li><span className="check-icon">✓</span> <strong>90-Day Data Retention</strong></li>
                <li><span className="check-icon">✓</span> Multi-Environment Management</li>
                <li><span className="check-icon">✓</span> Log Insights & Error Grouping</li>
                <li><span className="check-icon">✓</span> Priority Support & SLA</li>
              </ul>

              <Link href="/sign-up" className="btn-secondary landing-plan-btn">
                Upgrade to Team
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="landing-section">
        <div className="landing-container landing-faq-container">
          <div className="section-header-center">
            <span className="section-eyebrow">Got Questions?</span>
            <h2>Frequently Asked Questions</h2>
          </div>

          <div className="faq-list">
            {faqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={idx} className="faq-item glass-card" onClick={() => setOpenFaq(isOpen ? null : idx)}>
                  <div className="faq-question">
                    <span>{faq.q}</span>
                    <span className="faq-toggle-icon">{isOpen ? "−" : "+"}</span>
                  </div>
                  {isOpen && (
                    <div className="faq-answer animate-fade-in">
                      <p>{faq.a}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="landing-cta-section">
        <div className="landing-container">
          <div className="cta-banner glass-card animate-glow">
            <h2>Ready to Eliminate Database Blindspots?</h2>
            <p>Join hundreds of engineering teams who monitor their PostgreSQL vitals in real time.</p>
            <div className="cta-banner-actions">
              <Link href={isSignedIn ? "/" : "/sign-up"} className="btn-primary landing-hero-primary-btn">
                <span>Start Monitoring Free Today</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-container landing-footer-content">
          <div className="landing-footer-brand">
            <div className="landing-brand">
              <LogoIcon size={32} />
              <span className="landing-brand-title">PG Vitals</span>
            </div>
            <p className="landing-footer-tagline">
              Real-time PostgreSQL observability, diagnostics, and root-cause alerts.
            </p>
          </div>

          <div className="landing-footer-links">
            <div className="footer-col">
              <h4>Product</h4>
              <a href="#features">Features</a>
              <a href="#preview">Live Demo</a>
              <a href="#pricing">Pricing</a>
              <a href="#security">Security</a>
            </div>
            <div className="footer-col">
              <h4>Resources</h4>
              <a href="#how-it-works">Quickstart Guide</a>
              <a href="#faq">FAQ</a>
              <a href="https://github.com" target="_blank" rel="noreferrer">Documentation</a>
            </div>
            <div className="footer-col">
              <h4>Legal</h4>
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Service</a>
              <a href="#">Security Overview</a>
            </div>
          </div>
        </div>
        <div className="landing-footer-bottom">
          <div className="landing-container">
            <p>© {new Date().getFullYear()} PG Vitals. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
