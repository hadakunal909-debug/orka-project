-- ============================================================
-- Orka Management — Project sharing + Card attachments
--
-- 1. project_access: explicit per-project access list (sharing).
--    NOTE: there is already a VIEW named `project_members` that
--    derives membership from team_members. To avoid clobbering it,
--    this table is called `project_access`.
-- 2. card_attachments: file metadata for uploads. Actual binary
--    lives in the Supabase Storage bucket `card-attachments`.
--
-- Run this in the Supabase SQL editor, then create the storage
-- bucket via the Storage panel:
--    Bucket name: card-attachments
--    Public: NO
-- ============================================================

-- ---- 1. project_access ----
create table if not exists project_access (
  project_id uuid references projects(id) on delete cascade not null,
  user_id    uuid references users(id)    on delete cascade not null,
  role       text not null default 'viewer'
             check (role in ('viewer', 'editor', 'owner')),
  added_at   timestamptz default now(),
  primary key (project_id, user_id)
);
create index if not exists idx_project_access_user on project_access(user_id);

-- ---- Project visibility flag ----
alter table projects
  add column if not exists visibility text not null default 'private'
  check (visibility in ('private', 'team', 'org'));
-- 'private' = only users listed in project_access
-- 'team'    = anyone in the assigned team (uses existing project_members view)
-- 'org'     = visible to everyone in the org (the old default behaviour)

-- ---- Auto-add project lead as owner when a project is created ----
create or replace function add_project_lead_as_owner()
returns trigger as $$
begin
  if new.lead_id is not null then
    insert into project_access (project_id, user_id, role)
    values (new.id, new.lead_id, 'owner')
    on conflict (project_id, user_id) do update set role = 'owner';
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists trg_add_project_lead on projects;
create trigger trg_add_project_lead
  after insert on projects
  for each row execute function add_project_lead_as_owner();

-- ---- Backfill: add existing project leads as owners ----
insert into project_access (project_id, user_id, role)
select id, lead_id, 'owner' from projects where lead_id is not null
on conflict (project_id, user_id) do nothing;

-- ---- 2. card_attachments ----
create table if not exists card_attachments (
  id uuid primary key default uuid_generate_v4(),
  card_id uuid references cards(id) on delete cascade not null,
  org_id  uuid references organizations(id) on delete cascade not null,
  uploader_id uuid references users(id) on delete set null,
  storage_path text not null,           -- path inside the `card-attachments` bucket
  filename text not null,                -- original filename for display
  content_type text,
  size_bytes bigint,
  created_at timestamptz default now()
);
create index if not exists idx_card_attachments_card on card_attachments(card_id);
create index if not exists idx_card_attachments_org  on card_attachments(org_id);

-- ============================================================
-- After running this:
--   1. In Supabase Studio → Storage, create bucket `card-attachments`
--      with public access OFF (signed URLs will be used).
--   2. Add Storage policies so authenticated users can upload + read:
--
--      create policy "Authenticated upload card-attachments"
--        on storage.objects for insert to authenticated
--        with check (bucket_id = 'card-attachments');
--
--      create policy "Authenticated read card-attachments"
--        on storage.objects for select to authenticated
--        using (bucket_id = 'card-attachments');
--
--      create policy "Authenticated delete card-attachments"
--        on storage.objects for delete to authenticated
--        using (bucket_id = 'card-attachments');
-- ============================================================
