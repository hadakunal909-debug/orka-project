-- ============================================================
-- Fix infinite recursion in pa_owner_manage RLS policy
--
-- The pa_owner_manage policy in 006_rls_for_005.sql queries
-- project_access from within a policy ON project_access.
-- PostgreSQL evaluates RLS policies when the table is accessed,
-- so the policy triggers a SELECT on the same table, which
-- triggers the policy again → infinite recursion → 500 error.
--
-- Fix: wrap the ownership check in a SECURITY DEFINER function,
-- which runs with elevated privileges and bypasses RLS on
-- project_access, breaking the recursion.
--
-- Safe to re-run.
-- ============================================================

-- Security-definer function: checks if the current auth user
-- holds the 'owner' role on a given project.
-- SECURITY DEFINER bypasses RLS on project_access so the
-- lookup doesn't recurse into the policy being evaluated.
create or replace function current_user_owns_project(p_project_id uuid)
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
      and role       = 'owner'
  )
$$;

-- Replace the recursive policy with one that uses the safe function
drop policy if exists "pa_owner_manage" on project_access;

create policy "pa_owner_manage" on project_access
  for all
  using      (current_user_owns_project(project_access.project_id))
  with check (current_user_owns_project(project_access.project_id));
