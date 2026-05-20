-- ============================================================
-- Card embeds — store iframe-embed URLs inline on the card.
--
-- Each card gets a jsonb `embeds` column holding an array of
--   { id: text, url: text, title: text, created_at: text }
-- objects. No new table = no extra RLS policies (inherits from cards).
--
-- Safe to re-run.
-- ============================================================
alter table cards add column if not exists embeds jsonb not null default '[]'::jsonb;
