-- Waitlist signup capture for the landing page (Phase 0 validation).
-- The full application schema arrives in Phase 1; this migration creates
-- only the waitlist table.

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  course_name text not null,
  state text not null,
  role text not null,
  utm_source text,
  created_at timestamptz not null default now()
);

create index if not exists waitlist_email_idx on public.waitlist (email);
create index if not exists waitlist_created_at_idx on public.waitlist (created_at desc);

-- Row Level Security: the public landing form inserts with the anon key.
-- Anyone may insert a signup; nobody may read, update, or delete rows
-- through the API (admin access happens via the Supabase dashboard or a
-- server-side service-role session, which bypasses RLS).
alter table public.waitlist enable row level security;

drop policy if exists "waitlist anon insert only" on public.waitlist;
create policy "waitlist anon insert only"
  on public.waitlist
  for insert
  to anon
  with check (true);
