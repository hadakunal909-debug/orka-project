-- ============================================================
-- Orka Management — Department palette refresh
-- Updates colors for existing departments and inserts new ones.
-- Run this in the Supabase SQL editor.
-- ============================================================
-- Color map:
--   HR          #3B82F6  (blue)
--   IT          #FACC15  (yellow)
--   Operations  #00A1FF  (sky)
--   Business    #5CA33D  (green)
--   Marketing   #8C4E9E  (purple)
-- ============================================================

do $$
declare
  v_org_id uuid;
begin
  -- Pick the first organization. If you have multiple orgs and want to scope
  -- this differently, change the where-clause below.
  select id into v_org_id from organizations order by created_at limit 1;
  if v_org_id is null then
    raise notice 'No organizations found; skipping.';
    return;
  end if;

  -- Update existing departments (no-op if absent)
  update departments set color = '#3B82F6'
    where org_id = v_org_id and name = 'HR';
  update departments set color = '#FACC15'
    where org_id = v_org_id and name = 'IT';
  update departments set color = '#8C4E9E'
    where org_id = v_org_id and name = 'Marketing';

  -- Insert the two new departments if missing
  insert into departments (org_id, name, description, color)
  values (v_org_id, 'Operations', 'Logistics, processes, internal ops.', '#00A1FF')
  on conflict (org_id, name) do update set color = excluded.color;

  insert into departments (org_id, name, description, color)
  values (v_org_id, 'Business',   'Sales, partnerships, revenue.',       '#5CA33D')
  on conflict (org_id, name) do update set color = excluded.color;
end $$;
