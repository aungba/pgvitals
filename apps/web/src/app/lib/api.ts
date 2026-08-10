/* ===================================================================
   PG Vitals — API Client
   Type-safe fetch wrapper for the collector API
   =================================================================== */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/collector-api";

/* ---------- Types ---------- */

export interface Database {
  id: string;
  name: string;
  connectionString: string;
  environment: "production" | "staging" | "development";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Snapshot {
  id: string;
  databaseId: string;
  connectionCount: number;
  activeCount: number;
  idleCount: number;
  idleInTxnCount: number;
  idleInTxnAbortedCount: number;
  maxConnections: number;
  timestamp: string;
}

export interface UtilizationData {
  percent: number;
  connectionCount: number;
  maxConnections: number;
}

export interface OverviewResponse {
  database: { id: string; name: string };
  snapshot: Snapshot | null;
  utilization: UtilizationData | null;
}

export interface Session {
  pid: number;
  usename: string;
  applicationName: string;
  clientAddr: string;
  state: string;
  stateDurationSeconds: number;
  queryText: string;
  queryStart: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  blockingPid: number | null;
}

export interface SessionsResponse {
  sessions: Session[];
}

export interface SnapshotsResponse {
  snapshots: Snapshot[];
}

export interface Hint {
  id: string;
  ruleType: string;
  severity: "warning" | "critical";
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  detectedAt: string;
}

export interface HintsResponse {
  hints: Hint[];
}

export interface CreateDatabasePayload {
  name: string;
  connectionString: string;
  environment: "production" | "staging" | "development";
}

/* ---------- Fetch helper ---------- */

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
import { getGlobalToken } from "./tokenStore";

async function request<T>(
  path: string,
  options?: RequestInit & { token?: string },
): Promise<T> {
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = {
    ...options?.headers as Record<string, string>,
  };
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  // Use provided token, or auto-fetch from global Clerk token getter
  let token = options?.token;
  if (!token) {
    try {
      token = (await getGlobalToken()) ?? undefined;
    } catch {
      // Clerk not available — continue without token (dev mode)
    }
  }

  // If no token yet and Clerk is configured, wait for it to load.
  // window.Clerk becomes available once the Clerk JS bundle loads,
  // which may be after the first React render cycle.
  const clerkConfigured = typeof window !== "undefined" &&
    !!(window as any).__clerk_publishable_key ||
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!token && clerkConfigured) {
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        token = (await getGlobalToken()) ?? undefined;
      } catch {
        // ignore
      }
      if (token) break;
    }
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.error || body.message || message;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}

/* ---------- API functions ---------- */

export async function getDatabases(token?: string): Promise<Database[]> {
  const data = await request<{ databases: Database[] }>("/api/databases", { token });
  return data.databases;
}

export async function getDatabase(id: string, token?: string): Promise<Database> {
  const data = await request<{ database: Database }>(`/api/databases/${id}`, { token });
  return data.database;
}

export async function createDatabase(
  payload: CreateDatabasePayload,
  token?: string,
): Promise<Database> {
  const data = await request<{ database: Database }>("/api/databases", {
    method: "POST",
    body: JSON.stringify(payload),
    token,
  });
  return data.database;
}

export async function deleteDatabase(id: string, token?: string): Promise<void> {
  await request<{ success: boolean }>(`/api/databases/${id}`, {
    method: "DELETE",
    token,
  });
}

export async function getOverview(id: string, token?: string): Promise<OverviewResponse> {
  return request<OverviewResponse>(`/api/databases/${id}/overview`, { token });
}

export async function getSessions(id: string, token?: string): Promise<Session[]> {
  const data = await request<SessionsResponse>(`/api/databases/${id}/sessions`, { token });
  return data.sessions;
}

export async function getSnapshots(
  id: string,
  limit = 100,
  token?: string,
): Promise<Snapshot[]> {
  const data = await request<SnapshotsResponse>(
    `/api/databases/${id}/snapshots?limit=${limit}`,
    { token },
  );
  return data.snapshots;
}

export async function getHints(id: string, token?: string): Promise<Hint[]> {
  const data = await request<HintsResponse>(`/api/databases/${id}/hints`, { token });
  return data.hints;
}

/* ---------- Alert Types ---------- */

export interface Alert {
  id: string;
  monitoredDbId: string;
  alertType: string;
  severity: "warning" | "critical";
  fingerprint: string;
  details: Record<string, unknown>;
  rootCauseHint: string | null;
  firedAt: string;
  resolvedAt: string | null;
  lastNotifiedAt: string | null;
  feedback: "useful" | "not_useful" | null;
  feedbackAt: string | null;
}

export interface AlertRule {
  id: string;
  monitoredDbId: string;
  alertType: string;
  thresholdValue: number;
  cooldownMinutes: number;
  enabled: boolean;
  channels: {
    slack?: { webhookUrl: string };
    email?: { smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; useTls: boolean; fromAddress: string; toAddresses: string[] };
  };
  createdAt: string;
  updatedAt: string;
}

/* ---------- Alert API Functions ---------- */

export async function getAlerts(
  dbId: string,
  status: "active" | "resolved" | "all" = "all",
  token?: string,
): Promise<Alert[]> {
  const data = await request<{ alerts: Alert[] }>(
    `/api/databases/${dbId}/alerts?status=${status}`,
    { token },
  );
  return data.alerts;
}

export async function getActiveAlerts(dbId: string, token?: string): Promise<Alert[]> {
  const data = await request<{ alerts: Alert[] }>(
    `/api/databases/${dbId}/alerts/active`,
    { token },
  );
  return data.alerts;
}

export async function getAlertRules(dbId: string, token?: string): Promise<AlertRule[]> {
  const data = await request<{ rules: AlertRule[] }>(
    `/api/databases/${dbId}/alert-rules`,
    { token },
  );
  return data.rules;
}

export async function createAlertRule(
  dbId: string,
  payload: {
    alertType: string;
    thresholdValue: number;
    cooldownMinutes?: number;
    enabled?: boolean;
    channels?: {
      slack?: { webhookUrl: string };
      email?: { smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; useTls: boolean; fromAddress: string; toAddresses: string[] };
    };
  },
  token?: string,
): Promise<AlertRule> {
  const data = await request<{ rule: AlertRule }>(
    `/api/databases/${dbId}/alert-rules`,
    { method: "POST", body: JSON.stringify(payload), token },
  );
  return data.rule;
}

export async function updateAlertRule(
  dbId: string,
  ruleId: string,
  payload: {
    thresholdValue?: number;
    cooldownMinutes?: number;
    enabled?: boolean;
    channels?: {
      slack?: { webhookUrl: string };
      email?: { smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; useTls: boolean; fromAddress: string; toAddresses: string[] };
    };
  },
  token?: string,
): Promise<AlertRule> {
  const data = await request<{ rule: AlertRule }>(
    `/api/databases/${dbId}/alert-rules/${ruleId}`,
    { method: "PUT", body: JSON.stringify(payload), token },
  );
  return data.rule;
}

export async function deleteAlertRule(
  dbId: string,
  ruleId: string,
  token?: string,
): Promise<void> {
  await request<{ success: boolean }>(
    `/api/databases/${dbId}/alert-rules/${ruleId}`,
    { method: "DELETE", token },
  );
}

export async function testAlertNotification(
  dbId: string,
  payload: {
    webhookUrl?: string;
    emailConfig?: { smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string; useTls: boolean; fromAddress: string; toAddresses: string[] };
  },
  token?: string,
): Promise<void> {
  await request<{ success: boolean }>(
    `/api/databases/${dbId}/alert-rules/test`,
    { method: "POST", body: JSON.stringify(payload), token },
  );
}

/* ---------- Query Performance Types ---------- */

export interface QueryStat {
  id: string;
  monitoredDbId: string;
  capturedAt: string;
  queryid: number;
  queryText: string;
  calls: number;
  totalTimeMs: number;
  meanTimeMs: number;
  maxTimeMs: number;
  minTimeMs: number;
  rowsReturned: number;
  rowsPerCall: number;
  sharedBlksHit: number;
  sharedBlksRead: number;
  tempBlksWritten: number;
  pctOfTotalTime: number;
  meanTimeTrend: number | null; // % change vs 7 days ago (e.g. 32.5 means +32.5%)
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface ExplainCapture {
  id: string;
  queryid: number;
  queryText: string;
  planJson: unknown;
  planText: string | null;
  warnings: Array<{
    type: string;
    message: string;
    nodeType: string;
    details: Record<string, unknown>;
  }>;
  capturedAt: string;
}

export interface QuerySuggestion {
  id: string;
  monitoredDbId: string;
  queryid: number;
  suggestionType: string;
  title: string;
  description: string;
  severity: string;
  metadata: Record<string, unknown>;
  detectedAt: string;
  dismissed: boolean;
}

/* ---------- Query Performance API Functions ---------- */

export async function getQueryStatsStatus(
  dbId: string,
  token?: string,
): Promise<{ available: boolean }> {
  return request<{ available: boolean }>(
    `/api/databases/${dbId}/query-stats/status`,
    { token },
  );
}

export async function getQueries(
  dbId: string,
  sort: "total_time" | "calls" | "mean_time" | "rows" | "temp_blks" = "total_time",
  limit = 50,
  token?: string,
): Promise<{ queries: QueryStat[]; latestCapturedAt: string | null }> {
  return request<{ queries: QueryStat[]; latestCapturedAt: string | null }>(
    `/api/databases/${dbId}/queries?sort=${sort}&limit=${limit}`,
    { token },
  );
}

export async function getQueryDetail(
  dbId: string,
  queryid: number,
  token?: string,
): Promise<{ query: QueryStat; timeSeries: QueryStat[] }> {
  return request<{ query: QueryStat; timeSeries: QueryStat[] }>(
    `/api/databases/${dbId}/queries/${queryid}`,
    { token },
  );
}

export async function captureExplainPlan(
  dbId: string,
  queryid: number,
  queryText: string,
  token?: string,
): Promise<{ explain: ExplainCapture }> {
  return request<{ explain: ExplainCapture }>(
    `/api/databases/${dbId}/queries/${queryid}/explain`,
    { method: "POST", body: JSON.stringify({ queryText }), token },
  );
}

export async function getExplainCaptures(
  dbId: string,
  queryid: number,
  token?: string,
): Promise<{ explains: ExplainCapture[] }> {
  return request<{ explains: ExplainCapture[] }>(
    `/api/databases/${dbId}/queries/${queryid}/explains`,
    { token },
  );
}

export async function getQuerySuggestions(
  dbId: string,
  dismissed = false,
  token?: string,
): Promise<{ suggestions: QuerySuggestion[] }> {
  return request<{ suggestions: QuerySuggestion[] }>(
    `/api/databases/${dbId}/query-suggestions?dismissed=${dismissed}`,
    { token },
  );
}

export async function dismissQuerySuggestion(
  dbId: string,
  sugId: string,
  token?: string,
): Promise<void> {
  await request<{ success: boolean }>(
    `/api/databases/${dbId}/query-suggestions/${sugId}/dismiss`,
    { method: "POST", token },
  );
}

/* ---------- Index Advisor Types ---------- */

export interface IndexRecommendation {
  id: string;
  monitoredDbId: string;
  tableName: string;
  indexName: string | null;
  recommendationType: "unused" | "missing";
  suggestedDdl: string | null;
  reason: string;
  impact: string;
  metadata: Record<string, unknown>;
  detectedAt: string;
  dismissed: boolean;
  dismissedAt: string | null;
}

/* ---------- Index Advisor API Functions ---------- */

export async function getIndexRecommendations(
  dbId: string,
  type?: "unused" | "missing",
  dismissed = false,
  token?: string,
): Promise<{ recommendations: IndexRecommendation[] }> {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  params.set("dismissed", String(dismissed));
  return request<{ recommendations: IndexRecommendation[] }>(
    `/api/databases/${dbId}/index-recommendations?${params}`,
    { token },
  );
}

export async function dismissRecommendation(
  dbId: string,
  recId: string,
  token?: string,
): Promise<void> {
  await request<{ success: boolean }>(
    `/api/databases/${dbId}/index-recommendations/${recId}/dismiss`,
    { method: "POST", token },
  );
}

export async function restoreRecommendation(
  dbId: string,
  recId: string,
  token?: string,
): Promise<void> {
  await request<{ success: boolean }>(
    `/api/databases/${dbId}/index-recommendations/${recId}/restore`,
    { method: "POST", token },
  );
}

export async function triggerIndexAnalysis(
  dbId: string,
  token?: string,
): Promise<{ unusedCount: number; missingCount: number }> {
  return request<{ unusedCount: number; missingCount: number }>(
    `/api/databases/${dbId}/index-recommendations/analyze`,
    { method: "POST", token },
  );
}

/* ---------- VACUUM & Health Types ---------- */

export interface TableBloatStat {
  id: string;
  tableName: string;
  schemaName: string;
  nLiveTup: number;
  nDeadTup: number;
  deadTupRatio: number;
  tableSizeBytes: number;
  totalSizeBytes: number;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
  vacuumCount: number;
  autovacuumCount: number;
  seqScan: number;
  idxScan: number;
  cacheHitRatio: number | null;
  idxCacheHitRatio: number | null;
  capturedAt: string;
}

export interface DbHealthSnapshot {
  id: string;
  capturedAt: string;
  cacheHitRatio: number | null;
  checkpointsRequested: number | null;
  checkpointsTimed: number | null;
  buffersCheckpoint: number | null;
  buffersBackend: number | null;
  dbSizeBytes: number | null;
  numBackends: number | null;
  xactCommit: number | null;
  xactRollback: number | null;
  conflictsCount: number | null;
  deadlocksCount: number | null;
  tempFileBytes: number | null;
  xidAge: number | null;
  autovacuumFreezeMaxAge: number | null;
  xidPercentUsed: number | null;
}

export interface TableCacheHit {
  tableName: string;
  cacheHitRatio: number | null;
  idxCacheHitRatio: number | null;
  totalSizeBytes: number;
}

export interface TableSizeEntry {
  tableName: string;
  schemaName: string;
  tableSizeBytes: number;
  indexSizeBytes: number;
  totalSizeBytes: number;
  growthRateBytesPerDay: number | null;
  projectedDaysToDiskLimit: number | null;
  capturedAt: string;
}

/* ---------- VACUUM & Health API Functions ---------- */

export async function getVacuumStats(
  dbId: string,
  token?: string,
): Promise<{ tables: TableBloatStat[]; capturedAt: string | null }> {
  return request<{ tables: TableBloatStat[]; capturedAt: string | null }>(
    `/api/databases/${dbId}/vacuum-stats`,
    { token },
  );
}

export async function getDbHealth(
  dbId: string,
  token?: string,
): Promise<{ current: DbHealthSnapshot | null; history: DbHealthSnapshot[] }> {
  return request<{ current: DbHealthSnapshot | null; history: DbHealthSnapshot[] }>(
    `/api/databases/${dbId}/health`,
    { token },
  );
}

export async function getTableCacheHit(
  dbId: string,
  token?: string,
): Promise<{ tables: TableCacheHit[]; capturedAt: string | null }> {
  return request<{ tables: TableCacheHit[]; capturedAt: string | null }>(
    `/api/databases/${dbId}/cache-hit`,
    { token },
  );
}

export async function getDiskGrowth(
  dbId: string,
  token?: string,
): Promise<{ tables: TableSizeEntry[]; history: Array<{ tableName: string; totalSizeBytes: number; capturedAt: string }>; capturedAt: string | null }> {
  return request<{ tables: TableSizeEntry[]; history: Array<{ tableName: string; totalSizeBytes: number; capturedAt: string }>; capturedAt: string | null }>(
    `/api/databases/${dbId}/disk-growth`,
    { token },
  );
}

/* ---------- Per-Table XID Ages ---------- */

export interface TableXidEntry {
  schemaName: string;
  tableName: string;
  xidAge: number;
  xidPercent: number;
  tableSize: number;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
}

export async function getXidPerTable(
  dbId: string,
  token?: string,
): Promise<{ freezeMaxAge: number; tables: TableXidEntry[] }> {
  return request<{ freezeMaxAge: number; tables: TableXidEntry[] }>(
    `/api/databases/${dbId}/xid-per-table`,
    { token },
  );
}

/* ---------- Replication Lag Monitor ---------- */

export interface ReplicationSnapshot {
  id: string;
  capturedAt: string;
  replicaName: string;
  clientAddr: string | null;
  replicationState: string;
  sentLsn: string | null;
  writeLsn: string | null;
  flushLsn: string | null;
  replayLsn: string | null;
  byteLag: number;
  timeLagSeconds: number | null;
  writeLagMs: number | null;
  flushLagMs: number | null;
  replayLagMs: number | null;
}

export interface ReplicationHistoryEntry {
  capturedAt: string;
  replicaName: string;
  byteLag: number;
  timeLagSeconds: number | null;
  replicationState: string;
}

export async function getReplicationStats(
  dbId: string,
  token?: string,
): Promise<{ replicas: ReplicationSnapshot[]; capturedAt: string | null }> {
  return request<{ replicas: ReplicationSnapshot[]; capturedAt: string | null }>(
    `/api/databases/${dbId}/replication`,
    { token },
  );
}

export async function getReplicationHistory(
  dbId: string,
  hours?: number,
  replica?: string,
  token?: string,
): Promise<{ history: ReplicationHistoryEntry[] }> {
  const params = new URLSearchParams();
  if (hours) params.set("hours", hours.toString());
  if (replica) params.set("replica", replica);
  const qs = params.toString();
  return request<{ history: ReplicationHistoryEntry[] }>(
    `/api/databases/${dbId}/replication/history${qs ? `?${qs}` : ""}`,
    { token },
  );
}

/* ---------- Log Insights ---------- */

export interface LogInsight {
  id: string;
  capturedAt: string;
  severity: "error" | "warning" | "info";
  errorType: string;
  errorMessage: string;
  errorCount: number;
  sampleQuery: string | null;
  databaseName: string | null;
  userName: string | null;
}

export interface DbErrorStatEntry {
  capturedAt: string;
  deadlocksCount: number;
  conflictsCount: number;
  rollbacksCount: number;
  tempFilesCount: number;
  tempFilesBytes: number;
}

export async function getLogInsights(
  dbId: string,
  hours?: number,
  severity?: string,
  token?: string,
): Promise<{ insights: LogInsight[] }> {
  const params = new URLSearchParams();
  if (hours) params.set("hours", hours.toString());
  if (severity) params.set("severity", severity);
  const qs = params.toString();
  return request<{ insights: LogInsight[] }>(
    `/api/databases/${dbId}/log-insights${qs ? `?${qs}` : ""}`,
    { token },
  );
}

export async function getErrorStats(
  dbId: string,
  hours?: number,
  token?: string,
): Promise<{ stats: DbErrorStatEntry[] }> {
  const params = new URLSearchParams();
  if (hours) params.set("hours", hours.toString());
  const qs = params.toString();
  return request<{ stats: DbErrorStatEntry[] }>(
    `/api/databases/${dbId}/error-stats${qs ? `?${qs}` : ""}`,
    { token },
  );
}

/* ---------- Organization & Team Management ---------- */

export interface Organization {
  id: string;
  name: string;
  planTier: "free" | "pro" | "team";
  createdAt: string;
}

export interface TeamMember {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
}

export async function getOrganization(token?: string): Promise<Organization> {
  const data = await request<{ org: Organization }>("/api/org", { token });
  return data.org;
}

export async function updateOrganization(
  name: string,
  token?: string,
): Promise<Organization> {
  const data = await request<{ org: Organization }>("/api/org", {
    method: "PUT",
    body: JSON.stringify({ name }),
    token,
  });
  return data.org;
}

export async function getTeamMembers(token?: string): Promise<TeamMember[]> {
  const data = await request<{ members: TeamMember[] }>("/api/org/members", { token });
  return data.members;
}

export async function inviteTeamMember(
  email: string,
  role?: "admin" | "member",
  token?: string,
): Promise<TeamMember> {
  const data = await request<{ member: TeamMember }>("/api/org/members", {
    method: "POST",
    body: JSON.stringify({ email, role }),
    token,
  });
  return data.member;
}

export async function updateMemberRole(
  memberId: string,
  role: "admin" | "member",
  token?: string,
): Promise<TeamMember> {
  const data = await request<{ member: TeamMember }>(`/api/org/members/${memberId}`, {
    method: "PUT",
    body: JSON.stringify({ role }),
    token,
  });
  return data.member;
}

export async function removeMember(
  memberId: string,
  token?: string,
): Promise<void> {
  await request<{ success: boolean }>(`/api/org/members/${memberId}`, {
    method: "DELETE",
    token,
  });
}

/* ---------- Cost-Per-Query Estimator (§2.11) ---------- */

export interface QueryCostEstimate {
  queryid: number;
  queryText: string;
  calls: number;
  totalTimeMs: number;
  estimatedIoCostPerMonth: number;
  estimatedCpuCostPerMonth: number;
  estimatedTotalCostPerMonth: number;
  breakdown: {
    diskReadsPerMonth: number;
    cpuSecondsPerMonth: number;
  };
}

export async function getQueryCostEstimates(
  dbId: string,
  token?: string,
): Promise<{ disclaimer: string; estimates: QueryCostEstimate[] }> {
  return request<{ disclaimer: string; estimates: QueryCostEstimate[] }>(
    `/api/databases/${dbId}/queries/cost-estimates`,
    { token },
  );
}

/* ---------- Plan Regression Detection (§2.10) ---------- */

export interface PlanSnapshot {
  id: string;
  queryid: number;
  capturedAt: string;
  planShapeHash: string;
  estimatedCost: number | null;
  topNodeType: string | null;
  planFlags: Record<string, boolean> | null;
  planJson: object | null;
  regression: string | null;
}

export async function getTrackedPlanQueryIds(
  dbId: string,
  token?: string,
): Promise<number[]> {
  const data = await request<{ queryids: number[] }>(
    `/api/databases/${dbId}/queries/plan-tracked`,
    { token },
  );
  return data.queryids;
}

export async function getQueryPlanHistory(
  dbId: string,
  queryid: number,
  token?: string,
): Promise<{ plans: PlanSnapshot[] }> {
  return request<{ plans: PlanSnapshot[] }>(
    `/api/databases/${dbId}/queries/${queryid}/plans`,
    { token },
  );
}

/* ---------- Schema Change Markers (§2.13) ---------- */

export interface SchemaEvent {
  id: string;
  eventType: string;
  objectName: string;
  detectedAt: string;
  details: Record<string, unknown> | null;
}

export async function getSchemaEvents(
  dbId: string,
  token?: string,
): Promise<{ events: SchemaEvent[] }> {
  return request<{ events: SchemaEvent[] }>(
    `/api/databases/${dbId}/schema-events`,
    { token },
  );
}

/* ---------- PgBouncer Pool Stats (§2.12) ---------- */

export interface PoolerSnapshot {
  poolName: string;
  clActive: number;
  clWaiting: number;
  svActive: number;
  svIdle: number;
  avgWaitTimeMs: number | null;
  capturedAt: string;
}

export async function getPoolerStats(
  dbId: string,
  token?: string,
): Promise<{ pools: PoolerSnapshot[] }> {
  return request<{ pools: PoolerSnapshot[] }>(
    `/api/databases/${dbId}/pooler`,
    { token },
  );
}

export async function getPoolerHistory(
  dbId: string,
  token?: string,
): Promise<{ history: PoolerSnapshot[] }> {
  return request<{ history: PoolerSnapshot[] }>(
    `/api/databases/${dbId}/pooler/history`,
    { token },
  );
}

/* ---------- Alert Feedback (§11) ---------- */

export async function submitAlertFeedback(
  alertId: string,
  feedback: "useful" | "not_useful",
  token?: string,
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/alerts/${alertId}/feedback`, {
    method: "PATCH",
    body: JSON.stringify({ feedback }),
    token,
  });
}

/* ---------- HypoPG Index Simulation (§2.4) ---------- */

export interface IndexSimulationResult {
  indexDdl: string;
  tableName: string;
  testQuery: string;
  costBefore: number;
  costAfter: number;
  costReductionPct: number;
  planBefore: string;
  planAfter: string;
}

export async function simulateIndex(
  dbId: string,
  indexDdl: string,
  testQuery: string,
  token?: string,
): Promise<IndexSimulationResult> {
  return request<IndexSimulationResult>(
    `/api/databases/${dbId}/indexes/simulate`,
    { method: "POST", body: JSON.stringify({ indexDdl, testQuery }), token },
  );
}
