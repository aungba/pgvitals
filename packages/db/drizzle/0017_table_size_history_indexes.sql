CREATE INDEX IF NOT EXISTS "idx_table_size_history_db_captured" ON "table_size_history" ("monitored_db_id", "captured_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_table_size_history_db_table_captured" ON "table_size_history" ("monitored_db_id", "table_name", "captured_at" DESC);
