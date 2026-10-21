-- ─── Event wizard Extras & publish step (M4-T007) ──────────────────────────
-- The wizard's final step persists flights, side games, payout settings,
-- sponsor logos, the welcome message, and public visibility on the event,
-- and the Publish action atomically materializes the access surfaces the
-- game-day features depend on:
--   * events.short_code      — unique public/TV URL slug
--   * per-group tokens       — event_players.group_token is already the
--                              32-char crypto-random column; publish mints a
--                              fresh token for every group member
--   * events.scorer_pin_hash — publish rotates the placeholder draft hash to
--                              the real 4-digit scorer PIN (salted)
--   * event_sponsors         — club-scoped sponsor rows (logos in Storage)
--
-- RLS: grants + policies follow the Phase 1 conventions
-- (supabase/migrations/20260101000200_enable_rls_policies.sql) — the new
-- tables are club-scoped through their event's club, exactly like
-- side_games, and events gains only columns.

-- ─── 1. events columns ──────────────────────────────────────────────────────

alter table public.events
  add column if not exists short_code text
    check (short_code is null or short_code ~ '^[a-z0-9]{6}$'),
  add column if not exists welcome_message text
    check (welcome_message is null or char_length(welcome_message) <= 2000),
  add column if not exists is_public boolean not null default true,
  add column if not exists published_at timestamptz,
  add column if not exists payout_preset_id text,
  add column if not exists payout_purse integer
    check (payout_purse is null or payout_purse >= 0);

create unique index if not exists events_short_code_key
  on public.events (short_code)
  where (short_code is not null);

comment on column public.events.short_code is
  'Publish step: unique 6-char code for the public/TV/score URLs.';
comment on column public.events.welcome_message is
  'Extras step: welcome message shown on the player surfaces.';
comment on column public.events.is_public is
  'Extras step: whether the public leaderboard/TV URLs resolve for strangers.';
comment on column public.events.published_at is
  'Publish step: when the draft became published (null while draft).';
comment on column public.events.payout_preset_id is
  'Extras step: the chosen payout preset (id from src/lib/events/extras.ts).';
comment on column public.events.payout_purse is
  'Extras step: the payout purse in whole currency units.';

-- ─── 2. side_games: skins value + the measurement games ──────────────────────
-- Phase 1 shipped skins/dots/nassau/wolf/vegas. The Extras step offers
-- skins (with a per-hole value), closest to pin, long drive, and longest
-- putt. The check constraint is swapped (not dropped) so existing rows stay
-- valid, then the new values are appended.

alter table public.side_games drop constraint if exists side_games_game_type_check;

alter table public.side_games
  add constraint side_games_game_type_check
    check (game_type in (
      'skins', 'dots', 'nassau', 'wolf', 'vegas',
      'closest_to_pin', 'long_drive', 'longest_putt'));

alter table public.side_games
  add column if not exists hole_value numeric(8, 2)
    check (hole_value is null or hole_value >= 0);

comment on column public.side_games.hole_value is
  'Extras step: skins per-hole value in currency units (carryover per @teeboard/scoring).';

-- ─── 3. event_flights ───────────────────────────────────────────────────────
-- Committee-configured handicap-threshold flights (@teeboard/scoring
-- assignFlights consumes exactly this shape at scoring time).

create table if not exists public.event_flights (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  max_handicap numeric(4, 1)
    check (max_handicap is null or max_handicap between -10 and 54),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, name)
);

create index if not exists event_flights_event_idx
  on public.event_flights (event_id);

comment on table public.event_flights is
  'Extras step: handicap-threshold flights per event (null max_handicap = open top).';

-- ─── 4. event_sponsors ──────────────────────────────────────────────────────
-- Up to 8 sponsor logos per event; logos live in Supabase Storage under the
-- club's folder (see the sponsor-logos bucket below), so no file bytes ever
-- touch the database.

create table if not exists public.event_sponsors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  logo_path text not null,
  position smallint not null default 0
    check (position between 0 and 7),
  created_at timestamptz not null default now(),
  unique (event_id, name)
);

create index if not exists event_sponsors_event_idx
  on public.event_sponsors (event_id);

comment on table public.event_sponsors is
  'Extras step: sponsor logos per event (max 8 via position check); files in Storage.';

-- ─── 5. RLS: grants + policies for the new tables ────────────────────────────

revoke all on table public.event_flights from anon, authenticated;
revoke all on table public.event_sponsors from anon, authenticated;

grant select, insert, update, delete
  on table public.event_flights to authenticated;
grant select, insert, update, delete
  on table public.event_sponsors to authenticated;

grant all on table public.event_flights to service_role;
grant all on table public.event_sponsors to service_role;

alter table public.event_flights enable row level security;
alter table public.event_sponsors enable row level security;

create policy "service_role full access"
  on public.event_flights for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club flights"
  on public.event_flights for all
  to authenticated
  using (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.event_flights.event_id
  )))
  with check (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.event_flights.event_id
  )));

create policy "service_role full access"
  on public.event_sponsors for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club sponsors"
  on public.event_sponsors for all
  to authenticated
  using (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.event_sponsors.event_id
  )))
  with check (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.event_sponsors.event_id
  )));

-- ─── 6. Storage: club-scoped sponsor-logos bucket ────────────────────────────
-- The bucket is public-read (sponsor logos render on public leaderboards);
-- writes are club-scoped via storage policies keyed on the path prefix
-- (`<club_id>/...`), so club A can never overwrite club B's logos. The
-- `insert into storage.buckets` form only exists on Supabase — the guard
-- skips the whole block on a plain Postgres test instance (no storage
-- schema), so `npm run test:rls` runs this file unchanged.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    if not exists (
      select 1 from storage.buckets where id = 'sponsor-logos'
    ) then
      insert into storage.buckets (id, name, public)
      values ('sponsor-logos', 'sponsor-logos', true);
    end if;
  end if;
end
$$;

-- Uploads/overwrites/deletes are club-scoped by the object path prefix;
-- downloads are public (anon included) so the public leaderboard can render
-- sponsor logos client-side. The `objects` table only exists on Supabase —
-- the policy guards keep this file safe on plain Postgres too.

do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'storage' and table_name = 'objects'
  ) then
    execute $policies$
      alter table storage.objects enable row level security;

      drop policy if exists "service_role full access" on storage.objects;
      create policy "service_role full access"
        on storage.objects for all
        to service_role
        using (true)
        with check (true);

      drop policy if exists "public read sponsor logos" on storage.objects;
      create policy "public read sponsor logos"
        on storage.objects for select
        to anon, authenticated
        using (bucket_id = 'sponsor-logos');

      drop policy if exists "staff write own club sponsor logos" on storage.objects;
      create policy "staff write own club sponsor logos"
        on storage.objects for insert
        to authenticated
        with check (
          bucket_id = 'sponsor-logos'
          and name ~ '^[0-9a-f-]{36}/'
          and private._is_staff_of(
            (split_part(name, '/', 1))::uuid)
        );

      drop policy if exists "staff update own club sponsor logos" on storage.objects;
      create policy "staff update own club sponsor logos"
        on storage.objects for update
        to authenticated
        using (
          bucket_id = 'sponsor-logos'
          and name ~ '^[0-9a-f-]{36}/'
          and private._is_staff_of(
            (split_part(name, '/', 1))::uuid)
        )
        with check (
          bucket_id = 'sponsor-logos'
          and name ~ '^[0-9a-f-]{36}/'
          and private._is_staff_of(
            (split_part(name, '/', 1))::uuid)
        );

      drop policy if exists "staff delete own club sponsor logos" on storage.objects;
      create policy "staff delete own club sponsor logos"
        on storage.objects for delete
        to authenticated
        using (
          bucket_id = 'sponsor-logos'
          and name ~ '^[0-9a-f-]{36}/'
          and private._is_staff_of(
            (split_part(name, '/', 1))::uuid)
        );
    $policies$;
  end if;
end
$$;
