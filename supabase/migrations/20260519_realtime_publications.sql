-- ============================================================
-- Migration — Enable Supabase realtime broadcasts for cards,
-- feedback_log, and projects.
--
-- Run in Supabase SQL Editor. Safe to re-run (idempotent via
-- per-table exception swallowing).
--
-- After this runs, the client-side postgres_changes subscriptions
-- in DashboardClient will start receiving INSERT/UPDATE/DELETE
-- events for these tables. Without this migration, the realtime
-- subscription will connect but no events will ever fire.
--
-- Note: realtime broadcasts do NOT enforce RLS by default —
-- subscribers receive all changes on subscribed tables.
-- The client filters defensively by org_id; combine with proper
-- RLS on SELECT for read protection.
-- ============================================================

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE cards;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE feedback_log;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE projects;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
