/* ===================================================================
   PG Vitals — API Client
   Type-safe fetch wrapper for the collector API
   =================================================================== */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = {
    ...options?.headers as Record<string, string>,
  };
  if (options?.body) {
    headers["Content-Type"] = "application/json";
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

export async function getDatabases(): Promise<Database[]> {
  const data = await request<{ databases: Database[] }>("/api/databases");
  return data.databases;
}

export async function getDatabase(id: string): Promise<Database> {
  const data = await request<{ database: Database }>(`/api/databases/${id}`);
  return data.database;
}

export async function createDatabase(
  payload: CreateDatabasePayload,
): Promise<Database> {
  const data = await request<{ database: Database }>("/api/databases", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.database;
}

export async function deleteDatabase(id: string): Promise<void> {
  await request<{ success: boolean }>(`/api/databases/${id}`, {
    method: "DELETE",
  });
}

export async function getOverview(id: string): Promise<OverviewResponse> {
  return request<OverviewResponse>(`/api/databases/${id}/overview`);
}

export async function getSessions(id: string): Promise<Session[]> {
  const data = await request<SessionsResponse>(`/api/databases/${id}/sessions`);
  return data.sessions;
}

export async function getSnapshots(
  id: string,
  limit = 100,
): Promise<Snapshot[]> {
  const data = await request<SnapshotsResponse>(
    `/api/databases/${id}/snapshots?limit=${limit}`,
  );
  return data.snapshots;
}

export async function getHints(id: string): Promise<Hint[]> {
  const data = await request<HintsResponse>(`/api/databases/${id}/hints`);
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
}

export interface AlertRule {
  id: string;
  monitoredDbId: string;
  alertType: string;
  thresholdValue: number;
  cooldownMinutes: number;
  enabled: boolean;
  channels: { slack?: { webhookUrl: string } };
  createdAt: string;
  updatedAt: string;
}

/* ---------- Alert API Functions ---------- */

export async function getAlerts(
  dbId: string,
  status: "active" | "resolved" | "all" = "all",
): Promise<Alert[]> {
  const data = await request<{ alerts: Alert[] }>(
    `/api/databases/${dbId}/alerts?status=${status}`,
  );
  return data.alerts;
}

export async function getActiveAlerts(dbId: string): Promise<Alert[]> {
  const data = await request<{ alerts: Alert[] }>(
    `/api/databases/${dbId}/alerts/active`,
  );
  return data.alerts;
}

export async function getAlertRules(dbId: string): Promise<AlertRule[]> {
  const data = await request<{ rules: AlertRule[] }>(
    `/api/databases/${dbId}/alert-rules`,
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
    channels?: { slack?: { webhookUrl: string } };
  },
): Promise<AlertRule> {
  const data = await request<{ rule: AlertRule }>(
    `/api/databases/${dbId}/alert-rules`,
    { method: "POST", body: JSON.stringify(payload) },
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
    channels?: { slack?: { webhookUrl: string } };
  },
): Promise<AlertRule> {
  const data = await request<{ rule: AlertRule }>(
    `/api/databases/${dbId}/alert-rules/${ruleId}`,
    { method: "PUT", body: JSON.stringify(payload) },
  );
  return data.rule;
}

export async function deleteAlertRule(
  dbId: string,
  ruleId: string,
): Promise<void> {
  await request<{ success: boolean }>(
    `/api/databases/${dbId}/alert-rules/${ruleId}`,
    { method: "DELETE" },
  );
}

export async function testAlertNotification(
  dbId: string,
  webhookUrl: string,
): Promise<void> {
  await request<{ success: boolean }>(
    `/api/databases/${dbId}/alert-rules/test`,
    { method: "POST", body: JSON.stringify({ webhookUrl }) },
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
  sharedBlksHit: number;
  sharedBlksRead: number;
  pctOfTotalTime: number;
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

/* ---------- Query Performance API Functions ---------- */

export async function getQueryStatsStatus(
  dbId: string,
): Promise<{ available: boolean }> {
  return request<{ available: boolean }>(
    `/api/databases/${dbId}/query-stats/status`,
  );
}

export async function getQueries(
  dbId: string,
  sort: "total_time" | "calls" | "mean_time" | "rows" = "total_time",
  limit = 50,
): Promise<{ queries: QueryStat[]; latestCapturedAt: string | null }> {
  return request<{ queries: QueryStat[]; latestCapturedAt: string | null }>(
    `/api/databases/${dbId}/queries?sort=${sort}&limit=${limit}`,
  );
}

export async function getQueryDetail(
  dbId: string,
  queryid: number,
): Promise<{ query: QueryStat; timeSeries: QueryStat[] }> {
  return request<{ query: QueryStat; timeSeries: QueryStat[] }>(
    `/api/databases/${dbId}/queries/${queryid}`,
  );
}

export async function captureExplainPlan(
  dbId: string,
  queryid: number,
  queryText: string,
): Promise<{ explain: ExplainCapture }> {
  return request<{ explain: ExplainCapture }>(
    `/api/databases/${dbId}/queries/${queryid}/explain`,
    { method: "POST", body: JSON.stringify({ queryText }) },
  );
}

export async function getExplainCaptures(
  dbId: string,
  queryid: number,
): Promise<{ explains: ExplainCapture[] }> {
  return request<{ explains: ExplainCapture[] }>(
    `/api/databases/${dbId}/queries/${queryid}/explains`,
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
): Promise<{ recommendations: IndexRecommendation[] }> {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  params.set("dismissed", String(dismissed));
  return request<{ recommendations: IndexRecommendation[] }>(
    `/api/databases/${dbId}/index-recommendations?${params}`,
  );
}

export async function dismissRecommendation(
  dbId: string,
  recId: string,
): Promise<void> {
  await request<{ success: boolean }>(
    `/api/databases/${dbId}/index-recommendations/${recId}/dismiss`,
    { method: "POST" },
  );
}

export async function restoreRecommendation(
  dbId: string,
  recId: string,
): Promise<void> {
  await request<{ success: boolean }>(
    `/api/databases/${dbId}/index-recommendations/${recId}/restore`,
    { method: "POST" },
  );
}

export async function triggerIndexAnalysis(
  dbId: string,
): Promise<{ unusedCount: number; missingCount: number }> {
  return request<{ unusedCount: number; missingCount: number }>(
    `/api/databases/${dbId}/index-recommendations/analyze`,
    { method: "POST" },
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
}

/* ---------- VACUUM & Health API Functions ---------- */

export async function getVacuumStats(
  dbId: string,
): Promise<{ tables: TableBloatStat[]; capturedAt: string | null }> {
  return request<{ tables: TableBloatStat[]; capturedAt: string | null }>(
    `/api/databases/${dbId}/vacuum-stats`,
  );
}

export async function getDbHealth(
  dbId: string,
): Promise<{ current: DbHealthSnapshot | null; history: DbHealthSnapshot[] }> {
  return request<{ current: DbHealthSnapshot | null; history: DbHealthSnapshot[] }>(
    `/api/databases/${dbId}/health`,
  );
}
