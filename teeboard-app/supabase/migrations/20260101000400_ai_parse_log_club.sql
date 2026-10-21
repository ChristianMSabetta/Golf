-- ─── AI event setup (M4-T004) ──────────────────────────────────────────────
-- The one-sentence AI event setup logs every Claude call (success or
-- failure) to ai_parse_log. The log doubles as the rate-limit state: the
-- 30/day/club budget is derived by counting the current day's rows per
-- club, so the rows must be club-attributed.
--
-- The Phase 1 schema is otherwise frozen: no new rate-limit tables, no
-- policy changes for other tables. `club_id` is nullable to keep the
-- existing Phase 1 rows (and any direct event-scoped inserts) valid;
-- rows without a club are attributed through event_id → events.club_id
-- where present, and counted as global budget otherwise.

alter table public.ai_parse_log
  add column if not exists club_id uuid references public.clubs (id)
    on delete set null;

create index if not exists ai_parse_log_club_day_idx
  on public.ai_parse_log (club_id, created_at desc);

comment on column public.ai_parse_log.club_id is
  'Owning club for the parse attempt (rate-limit attribution: 30 calls/day/club; NULL for event-scoped legacy rows).';
