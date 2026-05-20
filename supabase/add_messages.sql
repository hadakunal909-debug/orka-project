-- ============================================================
-- Stagework — Messages / Chat migration
-- Run this after schema.sql if messages table doesn't exist yet.
-- ============================================================

create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade not null,
  project_id uuid references projects(id) on delete cascade,
  card_id uuid references cards(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  content text not null check (char_length(content) >= 1 and char_length(content) <= 4000),
  mentions uuid[] not null default '{}',
  created_at timestamptz default now()
);

create index if not exists idx_messages_project on messages(project_id, created_at asc) where project_id is not null;
create index if not exists idx_messages_card on messages(card_id, created_at asc) where card_id is not null;
create index if not exists idx_messages_org on messages(org_id, created_at desc);
create index if not exists idx_messages_author on messages(author_id);

alter table messages enable row level security;

-- Org members can read all messages in their org
create policy "messages_read_org" on messages
  for select using (org_id = current_user_org());

-- Authenticated org members can post messages
create policy "messages_insert_org" on messages
  for insert with check (org_id = current_user_org() and author_id = auth.uid());

-- Authors can delete their own messages
create policy "messages_delete_own" on messages
  for delete using (author_id = auth.uid());

-- Enable realtime for live chat
alter publication supabase_realtime add table messages;
