-- AI parse log club attribution (M4-T004): every Claude call is logged to
-- ai_parse_log with the calling club, and the 30/day/club budget is
-- derived by counting those rows. Proves the new club_id column exists,
-- stays null-tolerant for legacy rows, and that staff isolation follows
-- the Phase 1 policy set (own-club rows only, via event_id → events when
-- set).
--
-- On Supabase: `supabase test db`
-- Local: `npm run test:rls`

begin;
select plan(7);

-- ─── Fixtures ──────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values
  ('12121212-1212-1212-1212-121212121212', 'ai-owner-a@example.com'),
  ('23232323-2323-2323-2323-232323232323', 'ai-owner-b@example.com');

insert into public.clubs (id, name, slug)
values
  ('aaaaaaa2-0000-4000-8000-00000000000a', 'AI Club A', 'ai-club-a'),
  ('aaaaaaa2-0000-4000-8000-00000000000b', 'AI Club B', 'ai-club-b');

insert into public.profiles (id, user_id, club_id, full_name, email, role)
values
  ('00000000-0000-4000-8000-000000000a2a', '12121212-1212-1212-1212-121212121212',
   'aaaaaaa2-0000-4000-8000-00000000000a', 'AI Owner A', 'ai-owner-a@example.com', 'owner'),
  ('00000000-0000-4000-8000-000000000b2b', '23232323-2323-2323-2323-232323232323',
   'aaaaaaa2-0000-4000-8000-00000000000b', 'AI Owner B', 'ai-owner-b@example.com', 'owner');

insert into public.courses (id, club_id, name)
values
  ('ccccccc2-0000-4000-8000-00000000000a', 'aaaaaaa2-0000-4000-8000-00000000000a', 'AI Course A'),
  ('ccccccc2-0000-4000-8000-00000000000b', 'aaaaaaa2-0000-4000-8000-00000000000b', 'AI Course B');

insert into public.events (id, club_id, course_id, name, start_date, scorer_pin_hash, scorer_pin_salt)
values
  ('eeeeeee2-0000-4000-8000-00000000000a', 'aaaaaaa2-0000-4000-8000-00000000000a',
   'ccccccc2-0000-4000-8000-00000000000a', 'AI Event A', current_date,
   encode(digest('pin-a', 'sha256'), 'hex'), 'salt-a'),
  ('eeeeeee2-0000-4000-8000-00000000000b', 'aaaaaaa2-0000-4000-8000-00000000000b',
   'ccccccc2-0000-4000-8000-00000000000b', 'AI Event B', current_date,
   encode(digest('pin-b', 'sha256'), 'hex'), 'salt-b');

-- service-role logging path (the adapter writes with club attribution)
insert into public.ai_parse_log (club_id, event_id, input, validated, model, latency_ms)
values
  ('aaaaaaa2-0000-4000-8000-00000000000a', 'eeeeeee2-0000-4000-8000-00000000000a',
   'scramble next saturday', true, 'claude-haiku-latest', 412),
  ('aaaaaaa2-0000-4000-8000-00000000000b', null,
   'best ball nine holes', false, 'claude-haiku-latest', 8000);

-- ─── structural ────────────────────────────────────────────────────────────
select has_column(
  'public', 'ai_parse_log', 'club_id',
  'ai_parse_log carries the club_id attribution column (M4-T004)'
);
select col_not_null(
  'public', 'clubs', 'id',
  'clubs.id stays the FK target (sanity fixture)'
);
select fk_ok(
  'public', 'ai_parse_log', 'club_id',
  'public', 'clubs', 'id',
  'ai_parse_log.club_id references clubs'
);
select ok(
  (select count(*) from pg_indexes
    where schemaname = 'public'
      and tablename = 'ai_parse_log'
      and indexname = 'ai_parse_log_club_day_idx') = 1,
  'ai_parse_log has the (club_id, created_at desc) rate-limit index'
);

-- ─── legacy rows stay valid (nullable attribution) ─────────────────────────
insert into public.ai_parse_log (event_id, input)
values ('eeeeeee2-0000-4000-8000-00000000000a', 'legacy row');
select is(
  (select count(*) from public.ai_parse_log where club_id is null)::int,
  1,
  'legacy event-scoped rows keep null club_id'
);

-- ─── staff isolation follows the Phase 1 policy set ─────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = '12121212-1212-1212-1212-121212121212';

select is(
  (select count(*) from public.ai_parse_log apl
    where apl.club_id = 'aaaaaaa2-0000-4000-8000-00000000000a'
       or apl.club_id is null
          and exists (
            select 1 from public.events e
             where e.id = apl.event_id
               and e.club_id = 'aaaaaaa2-0000-4000-8000-00000000000a'))::int,
  2,
  'club A staff read their attributed and event-scoped rows'
);
select is(
  (select count(*) from public.ai_parse_log apl
    where apl.club_id = 'aaaaaaa2-0000-4000-8000-00000000000b'
       or apl.club_id is null
          and exists (
            select 1 from public.events e
             where e.id = apl.event_id
               and e.club_id = 'aaaaaaa2-0000-4000-8000-00000000000b'))::int,
  0,
  'club A staff cannot read club B AI parse log rows'
);

select * from finish();
rollback;
