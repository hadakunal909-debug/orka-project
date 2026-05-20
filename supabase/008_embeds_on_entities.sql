-- ============================================================
-- Embeds on projects, teams, departments
--
-- Same pattern as 007_card_embeds.sql — store an array of
--   { id, url, title, created_at }
-- objects in a jsonb column. No new tables, no extra RLS.
--
-- Safe to re-run.
-- ============================================================
alter table projects    add column if not exists embeds jsonb not null default '[]'::jsonb;
alter table teams       add column if not exists embeds jsonb not null default '[]'::jsonb;
alter table departments add column if not exists embeds jsonb not null default '[]'::jsonb;
