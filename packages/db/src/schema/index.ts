// Schema barrel file — re-exports all tables and enums
export {
  organizations,
  users,
  monitoredDatabases,
  planTierEnum,
  userRoleEnum,
  environmentEnum,
} from "./organizations.js";

export {
  snapshots,
  sessionsSnapshot,
  rootCauseHints,
} from "./monitoring.js";

export {
  alerts,
  alertRules,
  alertTypeEnum,
  alertSeverityEnum,
} from "./alerting.js";

export {
  queryStats,
  explainCaptures,
  querySuggestions,
} from "./query-performance.js";

export {
  indexRecommendations,
  recommendationTypeEnum,
} from "./index-advisor.js";

export {
  tableBloatStats,
  dbHealthSnapshots,
  tableSizeHistory,
  autovacuumStarvationEvents,
} from "./vacuum-health.js";

export {
  replicationSnapshots,
} from "./replication.js";

export {
  logInsights,
  dbErrorStats,
  logSeverityEnum,
} from "./log-insights.js";

export {
  schemaEvents,
  schemaSnapshots,
} from "./schema-events.js";

export {
  queryPlanSnapshots,
} from "./query-plans.js";

export {
  poolerSnapshots,
} from "./pooler.js";
