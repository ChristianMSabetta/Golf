-- M2-T001 — Phase 1 full schema.
--
-- 21 domain tables (waitlist exists since Phase 0; 20 created here):
--   clubs, profiles, staff_invitations, superadmin_audit_log, courses, holes,
--   tee_sets, events, event_formats, players, event_players, groups, scores,
--   side_games, side_game_entries, score_audit, ai_parse_log, email_log,
--   leagues, league_members, waitlist
-- plus two server-side security state tables:
--   rate_limit_state (per-token request counters), pin_attempts (scorer PIN failures)
--
-- Row Level Security is enabled on every table with NO policies: deny-by-default
-- for anon/authenticated direct access. The security-definer submit_score(token,
-- hole, strokes) is the only write path a player token can reach. The
-- cross-club isolation policies land in M2-T002; invitation flows and
-- impersonation logic are deferred to the Phase 3 milestone.

-- ─── 1. clubs ────────────────────────────────────────────────────────────────
-- Tenant root. Plan/billing fields model the future commercial tiers as pure
-- columns; NO billing logic lives in any request path during Phase 1 (pilots free).

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  primary_color text,
  timezone text not null default 'America/New_York',
  country text not null default 'US',
  contact_email text,
  plan text not null default 'free'
    check (plan in ('free', 'pilot', 'pro')),
  billing_email text,
  billing_status text not null default 'inactive'
    check (billing_status in ('inactive', 'active', 'past_due', 'canceled')),
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clubs_slug_idx on public.clubs (slug);

-- ─── 2. profiles ─────────────────────────────────────────────────────────────
-- Staff/admin users mapped to Supabase auth users. Roles:
-- owner/head_pro/event_manager are staff roles; scorers use event PINs only and
-- players use group tokens — neither ever gets an auth account.

create type public.staff_role as enum (
  'owner', 'head_pro', 'event_manager', 'superadmin'
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  club_id uuid references public.clubs (id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.staff_role not null default 'event_manager',
  is_superadmin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_club_idx on public.profiles (club_id);
create index if not exists profiles_user_idx on public.profiles (user_id);

-- at most one owner per club (the tenant root); other staff roles are many
create unique index if not exists profiles_one_owner_per_club_idx
  on public.profiles (club_id) where (role = 'owner');

-- ─── 3. staff_invitations ────────────────────────────────────────────────────
-- Data model only in Phase 1: invitation flows are deferred to Phase 3.

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  email text not null,
  role public.staff_role not null default 'event_manager',
  token text not null unique,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (club_id, email)
);

create index if not exists staff_invitations_club_idx on public.staff_invitations (club_id);
create index if not exists staff_invitations_token_idx on public.staff_invitations (token);

-- ─── 4. superadmin_audit_log ────────────────────────────────────────────────
-- Data model only in Phase 1: impersonation logic lands in Phase 3.

create table public.superadmin_audit_log (
  id bigint generated always as identity primary key,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists superadmin_audit_log_created_at_idx
  on public.superadmin_audit_log (created_at desc);
create index if not exists superadmin_audit_log_actor_idx
  on public.superadmin_audit_log (actor_profile_id);

-- ─── 5. courses ──────────────────────────────────────────────────────────────

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null,
  city text,
  state text,
  country text not null default 'US',
  holes_count smallint not null default 18 check (holes_count in (9, 18)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, name)
);

create index if not exists courses_club_idx on public.courses (club_id);

-- ─── 6. holes ────────────────────────────────────────────────────────────────
-- Course data: par/stroke index/yards per hole. Handicap fields support WHS
-- calculations later; nothing here recomputes course ratings.

create table public.holes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  hole_number smallint not null check (hole_number between 1 and 18),
  par smallint not null check (par between 3 and 6),
  stroke_index smallint not null check (stroke_index between 1 and 18),
  yards smallint check (yards is null or yards between 0 and 800),
  unique (course_id, hole_number)
);

create index if not exists holes_course_idx on public.holes (course_id);

-- ─── 7. tee_sets ────────────────────────────────────────────────────────────
-- Course rating/slope by tee and gender (WHS inputs).

create type public.tee_gender as enum ('mens', 'womens');

create table public.tee_sets (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  name text not null,
  color text not null,
  gender public.tee_gender not null default 'mens',
  course_rating numeric(4, 1) check (course_rating is null or course_rating between 40 and 90),
  slope_rating smallint check (slope_rating is null or slope_rating between 55 and 155),
  unique (course_id, name, gender)
);

create index if not exists tee_sets_course_idx on public.tee_sets (course_id);

-- ─── 8. events ──────────────────────────────────────────────────────────────

create type public.event_status as enum ('draft', 'scheduled', 'live', 'completed', 'archived');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete restrict,
  name text not null,
  start_date date not null,
  status public.event_status not null default 'draft',
  -- scorer PIN: staff enter it at the scoring station; failures are tracked
  -- server-side in public.pin_attempts (locked_at + attempt counters)
  scorer_pin_hash text not null,
  scorer_pin_salt text not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists events_club_idx on public.events (club_id);
create index if not exists events_course_idx on public.events (course_id);
create index if not exists events_status_idx on public.events (status);
create index if not exists events_start_date_idx on public.events (start_date desc);

-- ─── 9. event_formats ───────────────────────────────────────────────────────
-- Scoring formats usable per event (stroke, stableford, match play, best ball …).

create type public.scoring_format as enum (
  'stroke_play', 'stableford', 'modified_stableford',
  'match_play', 'fourball', 'foursomes',
  'scramble', 'best_ball'
);

create table public.event_formats (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  format public.scoring_format not null,
  is_primary boolean not null default false,
  unique (event_id, format)
);

create index if not exists event_formats_event_idx on public.event_formats (event_id);

-- at most one primary format per event
create unique index if not exists event_formats_one_primary_idx
  on public.event_formats (event_id) where (is_primary);

-- ─── 10. players ─────────────────────────────────────────────────────────────
-- Club-level participant; handicap_index (WH) feeds WHS/USGA scoring.

create table public.players (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  gender public.tee_gender,
  handicap_index numeric(4,1) check (handicap_index is null or handicap_index between -5 and 54),
  whs_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists players_club_idx on public.players (club_id);
create index if not exists players_name_idx on public.players (full_name);

-- ─── 11. groups ──────────────────────────────────────────────────────────────
-- Playing groups within an event (foursomes, tee-time pairings).

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  tee_time timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, name)
);

create index if not exists groups_event_idx on public.groups (event_id);
create index if not exists groups_tee_time_idx on public.groups (tee_time);

-- ─── 12. event_players ──────────────────────────────────────────────────────
-- Event entry: one per player per event; group_token is the 32-char
-- crypto-random value printed/emailed to the player. Tokens are invalidated by
-- setting revoked_at (or by event completion checks inside submit_score).

create table public.event_players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  tee_set_id uuid references public.tee_sets (id) on delete set null,
  group_id uuid references public.groups (id) on delete set null,
  group_token text not null unique
    check (char_length(group_token) = 32)
    check (group_token ~ '^[0-9a-f]{32}$'),
  course_handicap smallint check (course_handicap is null or course_handicap between -10 and 60),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, player_id)
);

create index if not exists event_players_event_idx on public.event_players (event_id);
create index if not exists event_players_player_idx on public.event_players (player_id);
create index if not exists event_players_group_idx on public.event_players (group_id);
create index if not exists event_players_token_idx on public.event_players (group_token);

comment on column public.event_players.group_token is
  'Player group token: 32-char crypto-random hex, the only player write credential.';

-- ─── 13. scores ─────────────────────────────────────────────────────────────
-- Hole-by-hole scores. client_ts is the client wall-clock at write time; the
-- submit_score RPC upserts with client_ts so a stale offline replay never
-- overwrites a newer observation.

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  event_player_id uuid not null references public.event_players (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  strokes smallint not null check (strokes between 1 and 20),
  gross_adjusted smallint check (gross_adjusted is null or gross_adjusted between 0 and 20),
  points numeric(5, 2),
  client_ts timestamptz not null default now(),
  server_ts timestamptz not null default now(),
  unique (event_player_id, hole)
);

create index if not exists scores_event_idx on public.scores (event_id);
create index if not exists scores_event_player_idx on public.scores (event_player_id);
create index if not exists scores_hole_idx on public.scores (hole);

comment on column public.scores.client_ts is
  'Client timestamp on the device at score time; upsert guard for offline conflict resolution.';

-- ─── 14. side_games ──────────────────────────────────────────────────────────
-- Optional side games per event (skins, dots …).

create table public.side_games (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  game_type text not null
    check (game_type in ('skins', 'dots', 'nassau', 'wolf', 'vegas')),
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (event_id, name)
);

create index if not exists side_games_event_idx on public.side_games (event_id);

-- ─── 15. side_game_entries ───────────────────────────────────────────────────

create table public.side_game_entries (
  id uuid primary key default gen_random_uuid(),
  side_game_id uuid not null references public.side_games (id) on delete cascade,
  event_player_id uuid not null references public.event_players (id) on delete cascade,
  unique (side_game_id, event_player_id)
);

create index if not exists side_game_entries_side_game_idx on public.side_game_entries (side_game_id);
create index if not exists side_game_entries_event_player_idx on public.side_game_entries (event_player_id);

-- ─── 16. score_audit ─────────────────────────────────────────────────────────
-- Append-only audit trail for every score mutation.

create table public.score_audit (
  id bigint generated always as identity primary key,
  score_id uuid not null references public.scores (id) on delete cascade,
  event_player_id uuid not null references public.event_players (id) on delete cascade,
  hole smallint not null,
  old_strokes smallint,
  new_strokes smallint,
  source text not null
    check (source in ('player_token', 'scorer_pin', 'staff', 'system')),
  changed_by text,
  client_ts timestamptz,
  server_ts timestamptz not null default now()
);

create index if not exists score_audit_score_idx on public.score_audit (score_id);
create index if not exists score_audit_event_player_idx on public.score_audit (event_player_id);
create index if not exists score_audit_server_ts_idx on public.score_audit (server_ts desc);

-- ─── 17. ai_parse_log ───────────────────────────────────────────────────────
-- Claude Haiku scorecard-parse attempts (temp 0, Zod-validated JSON).

create table public.ai_parse_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events (id) on delete set null,
  input text not null,
  output jsonb,
  validated boolean,
  model text not null default 'claude-haiku',
  error text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists ai_parse_log_event_idx on public.ai_parse_log (event_id);
create index if not exists ai_parse_log_created_at_idx on public.ai_parse_log (created_at desc);

-- ─── 18. email_log ───────────────────────────────────────────────────────────
-- Outbound transactional email (Resend) record.

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs (id) on delete set null,
  to_email text not null,
  subject text not null,
  template text,
  provider text not null default 'resend',
  provider_message_id text,
  status text not null default 'sent'
    check (status in ('queued', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists email_log_club_idx on public.email_log (club_id);
create index if not exists email_log_to_email_idx on public.email_log (to_email);
create index if not exists email_log_created_at_idx on public.email_log (created_at desc);

-- ─── 19. leagues ─────────────────────────────────────────────────────────────

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null,
  season text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, name)
);

create index if not exists leagues_club_idx on public.leagues (club_id);

-- ─── 20. league_members ──────────────────────────────────────────────────────

create table public.league_members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  handicap_at_join numeric(4, 1),
  joined_at timestamptz not null default now(),
  unique (league_id, player_id)
);

create index if not exists league_members_league_idx on public.league_members (league_id);
create index if not exists league_members_player_idx on public.league_members (player_id);

-- ─── Server-side security state ──────────────────────────────────────────────

-- ─── rate_limit_state ────────────────────────────────────────────────────────
-- Fixed-window counters for authenticated write paths. submit_score uses the
-- per-group-token bucket: 60 requests/minute.

create table public.rate_limit_state (
  key text primary key,
  window_start timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ─── pin_attempts ────────────────────────────────────────────────────────────
-- Scorer PIN verification state per event: attempt counters and lockout window.
-- The lockout check itself lands with the scorer authorization layer (M2-T003).

create table public.pin_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  identifier text not null,
  attempt_count smallint not null default 0,
  locked_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, identifier)
);

create index if not exists pin_attempts_event_idx on public.pin_attempts (event_id);

-- ─── submit_score RPC ────────────────────────────────────────────────────────
-- The ONLY write path a group token can reach. SECURITY DEFINER + empty
-- search_path so RLS on public.scores cannot block it and no unqualified name
-- can be hijacked. Enforces:
--   1. token shape (32-char lowercase hex)
--   2. token belongs to a live event entry that is not revoked
--   3. 60 req/min per token via rate_limit_state (fixed window)
--   4. hole/strokes bounds (course-aware)
--   5. stale client_ts never overwrites a newer client_ts (offline conflicts)
-- Every accepted write lands a row in score_audit.

create or replace function public.submit_score(
  token text,
  hole smallint,
  strokes smallint,
  client_ts timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token_length constant int := 32;
  v_rate_limit constant int := 60;
  v_window constant int := 60; -- seconds
  v_event_player public.event_players;
  v_event public.events;
  v_holes_count smallint;
  v_rate_key text;
  v_window_start timestamptz;
  v_request_count int;
  v_existing public.scores;
  v_effective_client_ts timestamptz := coalesce(submit_score.client_ts, now());
  v_stale boolean;
  v_new_strokes smallint;
begin
  -- 1. token shape
  if submit_score.token is null
     or char_length(submit_score.token) <> v_token_length
     or submit_score.token !~ '^[0-9a-f]{32}$' then
    raise exception 'invalid group token'
      using errcode = '22023', hint = 'The group token is malformed.';
  end if;

  -- 2. token → live event entry (validated before the rate-limit write so a
  --    failed call never consumes the token's request budget)
  select ep.*
    into v_event_player
  from public.event_players ep
  where ep.group_token = submit_score.token;

  if v_event_player.id is null then
    raise exception 'unknown group token'
      using errcode = '22023', hint = 'No event entry matches this group token.';
  end if;

  if v_event_player.revoked_at is not null then
    raise exception 'group token revoked'
      using errcode = '22023', hint = 'This group token was revoked.';
  end if;

  select e.*
    into v_event
  from public.events e
  where e.id = v_event_player.event_id;

  if v_event.status not in ('scheduled', 'live') then
    raise exception 'event is not accepting scores'
      using errcode = '22023',
      hint = format('Event status is "%s"; scores are accepted while scheduled or live.',
        v_event.status);
  end if;

  -- 3. per-token fixed-window rate limit (60 req/min)
  v_rate_key := 'submit_score:' || submit_score.token;
  insert into public.rate_limit_state as rl (key, window_start, request_count)
    values (v_rate_key, date_trunc('minute', now()), 1)
  on conflict (key) do update
    set request_count = case
      when rl.window_start = date_trunc('minute', now()) then rl.request_count + 1
      else 1
    end,
    window_start = date_trunc('minute', now()),
    updated_at = now()
  returning request_count, window_start
    into v_request_count, v_window_start;

  if v_request_count > v_rate_limit then
    raise exception 'rate limit exceeded for group token'
      using errcode = 'PT429',
      hint = format('Limit is %s requests per %s seconds; window started at %s.',
        v_rate_limit, v_window, v_window_start),
      detail = format('Request %s in the current window.', v_request_count);
  end if;

  -- 4. bounds: strokes and hole
  if submit_score.strokes is null
     or submit_score.strokes < 1
     or submit_score.strokes > 20 then
    raise exception 'strokes out of range'
      using errcode = '22023', hint = 'Strokes must be between 1 and 20.';
  end if;

  select holes_count into v_holes_count
  from public.courses
  where id = v_event.course_id;

  if submit_score.hole is null
     or submit_score.hole < 1
     or submit_score.hole > coalesce(v_holes_count, 18) then
    raise exception 'hole out of range'
      using errcode = '22023',
      hint = format('Hole must be between 1 and %s.', coalesce(v_holes_count, 18));
  end if;

  -- 5. guarded upsert (client_ts conflict resolution): a stale offline replay
  --    never overwrites a newer observation
  select s.*
    into v_existing
  from public.scores s
  where s.event_player_id = v_event_player.id
    and s.hole = submit_score.hole
  for update;

  v_stale := v_existing.id is not null and v_effective_client_ts < v_existing.client_ts;

  if v_stale then
    v_new_strokes := v_existing.strokes;
  else
    v_new_strokes := submit_score.strokes;
    insert into public.scores
      (event_player_id, event_id, hole, strokes, client_ts, server_ts)
    values
      (v_event_player.id, v_event.id,
       submit_score.hole, submit_score.strokes,
       v_effective_client_ts, now())
    on conflict on constraint scores_event_player_id_hole_key do update
      set strokes = excluded.strokes,
        client_ts = excluded.client_ts,
        server_ts = now()
    returning * into v_existing;
  end if;

  -- 6. audit every mutation (accepted or stale-rejected)
  insert into public.score_audit
    (score_id, event_player_id, hole, old_strokes, new_strokes,
     source, changed_by, client_ts, server_ts)
  values
    (v_existing.id, v_event_player.id, submit_score.hole,
      case when v_stale then v_existing.strokes else null end,
      v_new_strokes,
     'player_token', 'group_token', v_effective_client_ts, now());

  return jsonb_build_object(
    'accepted', not v_stale,
    'hole', submit_score.hole,
    'strokes', v_new_strokes,
    'stale', v_stale,
    'event_player_id', v_event_player.id
  );
end;
$$;

revoke execute on function public.submit_score(text, smallint, smallint, timestamptz) from public;
grant execute on function public.submit_score(text, smallint, smallint, timestamptz) to anon, authenticated, service_role;

comment on function public.submit_score(text, smallint, smallint, timestamptz) is
  'Player-token score write path: security definer, 60 req/min per token, client_ts conflict resolution, audited.';

-- ─── Row Level Security: deny by default ─────────────────────────────────────
-- Every new table gets RLS enabled with no policies: anon/authenticated roles
-- cannot read or write anything directly (PostgREST would raise an RLS
-- violation). Policies land in M2-T002. The waitlist keeps its Phase 0
-- insert-only anon policy.

alter table public.clubs enable row level security;
alter table public.profiles enable row level security;
alter table public.staff_invitations enable row level security;
alter table public.superadmin_audit_log enable row level security;
alter table public.courses enable row level security;
alter table public.holes enable row level security;
alter table public.tee_sets enable row level security;
alter table public.events enable row level security;
alter table public.event_formats enable row level security;
alter table public.players enable row level security;
alter table public.groups enable row level security;
alter table public.event_players enable row level security;
alter table public.scores enable row level security;
alter table public.side_games enable row level security;
alter table public.side_game_entries enable row level security;
alter table public.score_audit enable row level security;
alter table public.ai_parse_log enable row level security;
alter table public.email_log enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.rate_limit_state enable row level security;
alter table public.pin_attempts enable row level security;
