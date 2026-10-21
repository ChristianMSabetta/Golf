-- ─── Event wizard drafts (M4-T003) ──────────────────────────────────────────
-- The 5-step event creation wizard persists its Basics and Format step data
-- on the existing Phase 1 tables: `events` gains the round-structure
-- columns the Basics step captures, and `event_formats` gains the Format
-- step's per-format settings (WHS defaults are applied client/server-side
-- from @teeboard/scoring, never assumed here).
--
-- RLS: no policy changes — the Phase 1 per-table policies
-- (supabase/migrations/20260101000200_enable_rls_policies.sql) already
-- isolate `events` and `event_formats` to the owning club's staff, so
-- draft events are invisible outside their club.

-- The wizard's Format step offers shamble alongside the Phase 1 enum
-- values; append-only so existing rows stay valid.
alter type public.scoring_format add value if not exists 'shamble';

alter table public.events
  add column if not exists holes_count smallint not null default 18
    check (holes_count in (9, 18)),
  add column if not exists nine_option text not null default 'front'
    check (nine_option in ('front', 'back')),
  add column if not exists rounds smallint not null default 1
    check (rounds between 1 and 2),
  add column if not exists start_type text not null default 'tee_times'
    check (start_type in ('tee_times', 'shotgun'));

comment on column public.events.holes_count is
  'Wizard Basics step: holes played per round (9 or 18).';
comment on column public.events.nine_option is
  'Wizard Basics step: which nine a 9-hole round plays (front/back).';
comment on column public.events.rounds is
  'Wizard Basics step: number of rounds (1–2).';
comment on column public.events.start_type is
  'Wizard Basics step: tee-times vs. shotgun start.';

-- Format step settings on the primary event_formats row. Allowance lives
-- as a percentage (95 = 95%); WHS defaults come from @teeboard/scoring.
alter table public.event_formats
  add column if not exists team_size smallint not null default 1
    check (team_size between 1 and 4),
  add column if not exists scoring_basis text not null default 'both'
    check (scoring_basis in ('gross', 'net', 'both')),
  add column if not exists handicap_allowance_pct numeric(4, 1)
    check (handicap_allowance_pct is null
      or handicap_allowance_pct between 0 and 100),
  add column if not exists max_score_rule text not null default 'none'
    check (max_score_rule in ('none', 'fixed', 'double_par', 'net_double_bogey')),
  add column if not exists max_score_fixed_cap smallint
    check (max_score_fixed_cap is null or max_score_fixed_cap between 2 and 20),
  add column if not exists tiebreak_method text not null default 'card_off'
    check (tiebreak_method in ('card_off', 'none'));

comment on column public.event_formats.team_size is
  'Wizard Format step: players per team (1 = individual).';
comment on column public.event_formats.scoring_basis is
  'Wizard Format step: gross/net/both scoring.';
comment on column public.event_formats.handicap_allowance_pct is
  'Wizard Format step: WHS handicap allowance percentage (e.g. 95).';
comment on column public.event_formats.max_score_rule is
  'Wizard Format step: maximum-score rule (none/fixed/double_par/net_double_bogey).';
comment on column public.event_formats.max_score_fixed_cap is
  'Wizard Format step: fixed cap strokes when max_score_rule = fixed.';
comment on column public.event_formats.tiebreak_method is
  'Wizard Format step: tiebreak method (USGA card-off or none).';
