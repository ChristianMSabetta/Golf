-- ─── Event wizard Groups & teams step (M4-T006) ────────────────────────────
-- The wizard's Groups step persists pairings against the Phase 1 `groups`
-- and `event_players` tables: a group row per playing group (foursome / team)
-- with its optional tee time, plus the shotgun-start and cart columns the
-- step adds here. No new tables — the Phase 1 schema already models groups
-- as event-scoped rows with `event_players.group_id` references.
--
-- RLS: no policy changes — the Phase 1 per-table policies
-- (supabase/migrations/20260101000200_enable_rls_policies.sql) already
-- isolate `groups` to the owning club's staff, so another club's groups
-- (and the draft events that own them) are invisible.

alter table public.groups
  add column if not exists starting_hole smallint
    check (starting_hole is null or starting_hole between 1 and 18),
  add column if not exists cart_number smallint
    check (cart_number is null or cart_number between 1 and 99);

comment on column public.groups.starting_hole is
  'Wizard Groups step: shotgun starting hole (null for tee-times events).';
comment on column public.groups.cart_number is
  'Wizard Groups step: cart number assigned to this group.';

-- A shotgun start plays each hole from at most one group per event: the
-- unique (event_id, starting_hole) pairs avoid double-booking a hole.
create unique index if not exists groups_event_starting_hole_idx
  on public.groups (event_id, starting_hole)
  where (starting_hole is not null);

-- The group name is the staff-facing label ("Group 1"); keep the display
-- order stable regardless of renames.
create index if not exists groups_cart_number_idx
  on public.groups (cart_number);
