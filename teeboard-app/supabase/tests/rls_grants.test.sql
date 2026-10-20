-- Structural RLS suite: RLS enabled with explicit policies on every table,
-- grants minimal and explicit, RPC execution granted to the right roles.
--
-- On Supabase: `supabase test db`
-- Local: `npm run test:rls`

begin;
select plan(21);

-- 23 tables from the Phase 1 schema (21 domain + 2 security state tables).
-- Every one must have RLS enabled.
select ok(
  (select count(*)
     from pg_tables t
    where t.schemaname = 'public'
      and t.rowsecurity
      and t.tablename in (
        'clubs', 'profiles', 'staff_invitations', 'superadmin_audit_log',
        'courses', 'holes', 'tee_sets', 'events', 'event_formats', 'players',
        'groups', 'event_players', 'scores', 'side_games', 'side_game_entries',
        'score_audit', 'ai_parse_log', 'email_log', 'leagues',
        'league_members', 'waitlist', 'rate_limit_state', 'pin_attempts'
      )) = 23,
  'RLS is enabled on all 23 Phase 1 tables'
);

-- every table carries at least one policy (deny-by-default is the floor,
-- not the ceiling)
select ok(
  (select count(distinct p.tablename)
     from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in (
        'clubs', 'profiles', 'staff_invitations', 'superadmin_audit_log',
        'courses', 'holes', 'tee_sets', 'events', 'event_formats', 'players',
        'groups', 'event_players', 'scores', 'side_games', 'side_game_entries',
        'score_audit', 'ai_parse_log', 'email_log', 'leagues',
        'league_members', 'waitlist', 'rate_limit_state', 'pin_attempts'
      )) = 23,
  'Every Phase 1 table has at least one explicit policy'
);

-- ─── anon gets nothing ────────────────────────────────────────────────────
select ok(
  (select count(*)
     from information_schema.table_privileges
    where grantee = 'anon'
      and table_schema = 'public'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      and table_name <> 'waitlist') = 0,
  'anon holds no privileges on any table except the waitlist insert'
);
select ok(
  (select count(*)
     from pg_policies
    where schemaname = 'public'
      and tablename <> 'waitlist'
      and (roles = '{anon}' or 'anon' = any (roles))) = 0,
  'no policy targets anon outside the waitlist'
);
select ok(
  has_table_privilege('anon', 'public.waitlist', 'INSERT'),
  'anon can insert a waitlist signup (Phase 0 behavior kept)'
);
select ok(
  not has_table_privilege('anon', 'public.waitlist', 'SELECT'),
  'anon can never read the waitlist'
);

-- ─── waitlist authenticated policy is insert-only ─────────────────────────
select is(
  (select count(*)
     from pg_policies
    where schemaname = 'public'
      and tablename = 'waitlist'
      and cmd in ('SELECT', 'UPDATE', 'DELETE'))::int,
  0,
  'waitlist policies expose no read/update/delete paths'
);

-- ─── helper functions: usable inside policies, not by the public ─────────
select ok(
  not has_function_privilege('public', 'private._is_superadmin()', 'EXECUTE'),
  'private._is_superadmin is not executable by PUBLIC'
);
select ok(
  not has_function_privilege('anon', 'private._is_staff_of(uuid)', 'EXECUTE'),
  'helper predicates are not directly callable by anon'
);

-- ─── submit_score RPC: revoked from PUBLIC, granted to anon ────────────────
select ok(
  not has_function_privilege('public', 'public.submit_score(text, smallint, smallint, timestamptz)', 'EXECUTE'),
  'submit_score is not executable by PUBLIC'
);
select ok(
  has_function_privilege('anon', 'public.submit_score(text, smallint, smallint, timestamptz)', 'EXECUTE'),
  'submit_score is executable by anon (player-token path)'
);
select ok(
  has_function_privilege('authenticated', 'public.submit_score(text, smallint, smallint, timestamptz)', 'EXECUTE'),
  'submit_score is executable by authenticated'
);

-- ─── authenticated grants are minimal and per-table ───────────────────────
select ok(
  has_table_privilege('authenticated', 'public.clubs', 'SELECT')
  and not has_table_privilege('authenticated', 'public.clubs', 'INSERT'),
  'clubs: authenticated can read but not create tenants'
);
select ok(
  not has_table_privilege('authenticated', 'public.superadmin_audit_log', 'UPDATE'),
  'superadmin_audit_log: authenticated cannot update (append-only)'
);
select ok(
  not has_table_privilege('authenticated', 'public.superadmin_audit_log', 'DELETE'),
  'superadmin_audit_log: authenticated cannot delete (append-only)'
);
select ok(
  not has_table_privilege('authenticated', 'public.score_audit', 'UPDATE'),
  'score_audit: authenticated cannot update (append-only)'
);
select ok(
  not has_table_privilege('authenticated', 'public.score_audit', 'DELETE'),
  'score_audit: authenticated cannot delete (append-only)'
);
select ok(
  not has_table_privilege('authenticated', 'public.rate_limit_state', 'INSERT'),
  'rate_limit_state: authenticated cannot create counters (RPC-owned)'
);
select ok(
  not has_table_privilege('authenticated', 'public.rate_limit_state', 'UPDATE'),
  'rate_limit_state: authenticated cannot update counters'
);
select ok(
  not has_table_privilege('authenticated', 'public.pin_attempts', 'INSERT'),
  'pin_attempts: authenticated cannot create rows (service-role only)'
);

-- ─── service_role keeps full access everywhere ──────────────────────────────
select ok(
  (select count(*)
     from information_schema.table_privileges
    where grantee = 'service_role'
      and table_schema = 'public'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      and table_name in (
        'clubs', 'profiles', 'staff_invitations', 'superadmin_audit_log',
        'courses', 'holes', 'tee_sets', 'events', 'event_formats', 'players',
        'groups', 'event_players', 'scores', 'side_games', 'side_game_entries',
        'score_audit', 'ai_parse_log', 'email_log', 'leagues',
        'league_members', 'waitlist', 'rate_limit_state', 'pin_attempts'
      )) = 92,
  'service_role holds all four privileges on all 23 tables'
);

select * from finish();
rollback;
