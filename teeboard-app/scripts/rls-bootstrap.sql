-- Local-test bootstrap for the supabase/tests/*.test.sql suites on a plain
-- Postgres instance (CI or laptop).  On Supabase the dashboard/CLI provision
-- all of this before the tests run; the idempotent guards let the file run
-- there too without error.
--
-- Assumes: migrations 20260101000000 + 20260101000100 + 20260101000200
-- applied, current user is the schema owner (superuser or supabase_admin).

create extension if not exists pgtap;
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

create schema if not exists auth;
-- minimal auth.users stub (tests insert fixture rows; the FK from
-- public.profiles needs it).  On Supabase the real table already exists —
-- the if-not-exists guard keeps this a no-op there.
create table if not exists auth.users (
  id uuid primary key,
  email text not null,
  unique (email)
);
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(
    current_setting('request.jwt.claim.sub', true),
    '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
