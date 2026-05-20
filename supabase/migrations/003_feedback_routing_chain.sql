-- ============================================================
-- Migration 003 — Feedback routing chain
-- Adds routing_chain jsonb to feedback_log so each handoff and
-- response is preserved as a chronological thread.
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================================

ALTER TABLE feedback_log
  ADD COLUMN IF NOT EXISTS routing_chain jsonb NOT NULL DEFAULT '[]';

-- routing_chain entry shape (appended on each route/respond action):
-- {
--   "from_id":   uuid,
--   "from_name": text,
--   "to_id":     uuid | null,   -- null = not routed, just responded
--   "note":      text,
--   "action":    "routed" | "responded",
--   "at":        timestamptz
-- }
