-- ============================================================
-- RLS policies for tables added in 005_project_members_attachments.sql
--
-- The 005 migration created `project_access` and `card_attachments`
-- but did not add RLS policies. If Supabase has RLS enabled by
-- default on new tables, all writes get rejected. This migration:
--   1. Enables RLS explicitly on both tables (idempotent)
--   2. Adds permissive-but-org-scoped policies that mirror the
--      patterns used elsewhere in schema.sql
--
-- Safe to re-run.
-- ============================================================

-- ---- project_access ----
alter table project_access enable row level security;

drop policy if exists "pa_read_org"        on project_access;
drop policy if exists "pa_admin_write"     on project_access;
drop policy if exists "pa_self_read"       on project_access;
drop policy if exists "pa_project_lead"    on project_access;

-- Anyone in the org can read which projects are shared with whom
create policy "pa_read_org" on project_access
  for select using (
    exists (
      select 1 from projects p
      where p.id = project_access.project_id
        and p.org_id = current_user_org()
    )
  );

-- Admins can do anything to access rows in their org
create policy "pa_admin_write" on project_access
  for all using (
    current_user_is_admin()
    and exists (
      select 1 from projects p
      where p.id = project_access.project_id
        and p.org_id = current_user_org()
    )
  )
  with check (
    current_user_is_admin()
    and exists (
      select 1 from projects p
      where p.id = project_access.project_id
        and p.org_id = current_user_org()
    )
  );

-- The project lead can manage their project's access list
create policy "pa_project_lead" on project_access
  for all using (
    exists (
      select 1 from projects p
      where p.id = project_access.project_id
        and p.lead_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from projects p
      where p.id = project_access.project_id
        and p.lead_id = auth.uid()
    )
  );

-- Users with 'owner' role on a project can also manage its access list
create policy "pa_owner_manage" on project_access
  for all using (
    exists (
      select 1 from project_access pa2
      where pa2.project_id = project_access.project_id
        and pa2.user_id = auth.uid()
        and pa2.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from project_access pa2
      where pa2.project_id = project_access.project_id
        and pa2.user_id = auth.uid()
        and pa2.role = 'owner'
    )
  );

-- ---- card_attachments ----
alter table card_attachments enable row level security;

drop policy if exists "ca_read_org"     on card_attachments;
drop policy if exists "ca_write_org"    on card_attachments;
drop policy if exists "ca_delete_own"   on card_attachments;
drop policy if exists "ca_admin_all"    on card_attachments;

-- Anyone in the same org can read attachments
create policy "ca_read_org" on card_attachments
  for select using (org_id = current_user_org());

-- Authenticated users in the org can upload attachments to any card in their org
create policy "ca_write_org" on card_attachments
  for insert with check (
    org_id = current_user_org()
    and uploader_id = auth.uid()
  );

-- Uploader can delete their own attachments
create policy "ca_delete_own" on card_attachments
  for delete using (
    uploader_id = auth.uid() and org_id = current_user_org()
  );

-- Admins can do anything to attachments in their org
create policy "ca_admin_all" on card_attachments
  for all using (current_user_is_admin() and org_id = current_user_org())
  with check (current_user_is_admin() and org_id = current_user_org());

-- ============================================================
-- Storage bucket policies (for the `card-attachments` bucket)
--
-- These also need to be in place. If you already ran them via the
-- Storage panel, the `drop policy if exists` lines make this safe to
-- re-run. Otherwise run these in the SQL editor too.
-- ============================================================

drop policy if exists "Authenticated upload card-attachments" on storage.objects;
drop policy if exists "Authenticated read card-attachments"   on storage.objects;
drop policy if exists "Authenticated delete card-attachments" on storage.objects;

create policy "Authenticated upload card-attachments"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'card-attachments');

create policy "Authenticated read card-attachments"
  on storage.objects for select to authenticated
  using (bucket_id = 'card-attachments');

create policy "Authenticated delete card-attachments"
  on storage.objects for delete to authenticated
  using (bucket_id = 'card-attachments');
