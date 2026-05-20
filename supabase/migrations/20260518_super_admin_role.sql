-- Add a top-level Super Admin role for executive visibility.

alter type user_role add value if not exists 'super_admin' before 'admin';

create or replace function current_user_is_admin() returns boolean as $$
  select role::text in ('super_admin', 'admin') from users where id = auth.uid()
$$ language sql security definer stable;

create or replace function current_user_is_super_admin() returns boolean as $$
  select role::text = 'super_admin' from users where id = auth.uid()
$$ language sql security definer stable;
