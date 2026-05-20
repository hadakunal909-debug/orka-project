-- ============================================================
-- Enforce project visibility via RLS
--
-- The `visibility` column was added in 005 but the
-- `projects_read_org` policy still lets every org member see
-- every project. This migration:
--
--   1. Adds a SECURITY DEFINER function to check project_access
--      without triggering RLS (avoids cross-table recursion with
--      pa_read_org, which itself queries projects).
--
--   2. Backfills all existing projects to visibility = 'org' so
--      nothing breaks for current data (they were all effectively
--      org-visible before this migration anyway).
--
--   3. Replaces projects_read_org with a visibility-aware policy:
--        org     → everyone in the org can see it
--        team    → only the project's team members can see it
--        private → only users in project_access can see it
--      Admins and the project lead always bypass the restriction.
--
-- Safe to re-run.
-- ============================================================

-- ---- 1. Helper: check project_access without triggering RLS ----
-- SECURITY DEFINER bypasses RLS on project_access, breaking the
-- potential recursion: projects_read_org → project_access →
-- pa_read_org → projects → projects_read_org → ...
create or replace function current_user_has_project_access(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from project_access
    where project_id = p_project_id
      and user_id    = auth.uid()
  )
$$;

-- ---- 2. Backfill: treat all existing projects as org-visible ----
-- Before this migration every project was visible to the whole org.
-- Preserve that for rows that still have the default 'private' value
-- (which was never enforced), so existing users lose no access.
update projects set visibility = 'org' where visibility = 'private';

-- ---- 3. Replace projects_read_org with visibility-aware policy ----
drop policy if exists "projects_read_org" on projects;

create policy "projects_read_org" on projects
  for select using (
    -- must always be in the same org
    org_id = current_user_org()
    and (
      -- admins see every project in their org
      current_user_is_admin()

      -- project lead always sees their own project
      or lead_id = auth.uid()

      -- org-wide: every org member can see it
      or visibility = 'org'

      -- team: only members of the assigned team
      or (
        visibility = 'team'
        and (
          team_id is null                          -- no team → treat as org-wide
          or current_user_in_team(team_id)
        )
      )

      -- private: only users explicitly granted access
      or (
        visibility = 'private'
        and current_user_has_project_access(id)
      )
    )
  );
