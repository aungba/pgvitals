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
} from "./query-performance.js";

export {
  indexRecommendations,
  recommendationTypeEnum,
} from "./index-advisor.js";

export {
  tableBloatStats,
  dbHealthSnapshots,
} from "./vacuum-health.js";
