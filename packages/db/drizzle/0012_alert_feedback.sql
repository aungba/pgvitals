-- Migration: Alert feedback (thumbs up/down)
-- Spec §11: "Root-cause hint usefulness (simple thumbs up/down on each alert)"

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS feedback VARCHAR(10) CHECK (feedback IN ('useful', 'not_useful'));
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ;
