-- ============================================================
-- Stagework — Direct Messages migration
-- Adds recipient_id to messages so users can DM each other.
-- Run this AFTER add_messages.sql.
-- ============================================================

alter table messages
  add column if not exists recipient_id uuid references users(id) on delete set null;

create index if not exists idx_messages_dm_pair
  on messages(author_id, recipient_id, created_at desc)
  where recipient_id is not null;

create index if not exists idx_messages_dm_recv
  on messages(recipient_id, author_id, created_at desc)
  where recipient_id is not null;

-- Replace read policy to allow DMs only to participants
drop policy if exists "messages_read_org" on messages;
drop policy if exists "messages_read" on messages;

create policy "messages_read" on messages
  for select using (
    -- Channel/card messages: visible to all org members
    (recipient_id is null and org_id = current_user_org())
    or
    -- DMs: only sender or recipient
    (recipient_id is not null and (author_id = auth.uid() or recipient_id = auth.uid()))
  );

-- Replace insert policy to validate DM recipients are in same org
drop policy if exists "messages_insert_org" on messages;
drop policy if exists "messages_insert" on messages;

create policy "messages_insert" on messages
  for insert with check (
    org_id = current_user_org()
    and author_id = auth.uid()
    and (
      recipient_id is null
      or exists (
        select 1 from users u where u.id = recipient_id and u.org_id = current_user_org()
      )
    )
  );
