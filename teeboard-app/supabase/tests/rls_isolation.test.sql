-- Cross-club isolation suite: two clubs (A, B), each with an owner profile,
-- a course, an event, players, groups, scores.  Proves on every table that
-- club A's staff can read/write only club A's rows and can never reach club
-- B's rows (nor vice versa), that anon gets nothing, that superadmin access
-- is gated on profiles.is_superadmin, and that only service_role and the
-- security-definer RPC can cross tenant boundaries.
--
-- On Supabase: `supabase test db`
-- Local: `npm run test:rls`

begin;
select plan(65);

-- ─── Fixtures ──────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'super@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'stranger@example.com');

insert into public.clubs (id, name, slug)
values
  ('aaaaaaa1-0000-4000-8000-00000000000a', 'Club A', 'club-a'),
  ('aaaaaaa1-0000-4000-8000-00000000000b', 'Club B', 'club-b');

insert into public.profiles (id, user_id, club_id, full_name, email, role)
values
  ('00000000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'aaaaaaa1-0000-4000-8000-00000000000a', 'Owner A', 'owner-a@example.com', 'owner'),
  ('00000000-0000-4000-8000-0000000000b1', '22222222-2222-2222-2222-222222222222',
   'aaaaaaa1-0000-4000-8000-00000000000b', 'Owner B', 'owner-b@example.com', 'owner'),
  ('00000000-0000-4000-8000-0000000005c1', '33333333-3333-3333-3333-333333333333',
   null, 'Super Admin', 'super@example.com', 'superadmin');
update public.profiles set is_superadmin = true
 where id = '00000000-0000-4000-8000-0000000005c1';

insert into public.courses (id, club_id, name)
values
  ('ccccccc1-0000-4000-8000-00000000000a', 'aaaaaaa1-0000-4000-8000-00000000000a', 'Course A'),
  ('ccccccc1-0000-4000-8000-00000000000b', 'aaaaaaa1-0000-4000-8000-00000000000b', 'Course B');

insert into public.holes (course_id, hole_number, par, stroke_index)
values
  ('ccccccc1-0000-4000-8000-00000000000a', 1, 4, 1),
  ('ccccccc1-0000-4000-8000-00000000000b', 1, 4, 1);

insert into public.tee_sets (id, course_id, name, color)
values
  ('ddddddd1-0000-4000-8000-00000000000a', 'ccccccc1-0000-4000-8000-00000000000a', 'White', 'white'),
  ('ddddddd1-0000-4000-8000-00000000000b', 'ccccccc1-0000-4000-8000-00000000000b', 'White', 'white');

insert into public.events (id, club_id, course_id, name, start_date, scorer_pin_hash, scorer_pin_salt)
values
  ('eeeeeee1-0000-4000-8000-00000000000a', 'aaaaaaa1-0000-4000-8000-00000000000a',
   'ccccccc1-0000-4000-8000-00000000000a', 'Event A', current_date,
   encode(digest('pin-a', 'sha256'), 'hex'), 'salt-a'),
  ('eeeeeee1-0000-4000-8000-00000000000b', 'aaaaaaa1-0000-4000-8000-00000000000b',
   'ccccccc1-0000-4000-8000-00000000000b', 'Event B', current_date,
   encode(digest('pin-b', 'sha256'), 'hex'), 'salt-b');

insert into public.event_formats (event_id, format, is_primary)
values
  ('eeeeeee1-0000-4000-8000-00000000000a', 'stroke_play', true),
  ('eeeeeee1-0000-4000-8000-00000000000b', 'stroke_play', true);

insert into public.players (id, club_id, full_name)
values
  ('11111111-0000-4000-8000-00000000000a', 'aaaaaaa1-0000-4000-8000-00000000000a', 'Player A'),
  ('11111111-0000-4000-8000-00000000000b', 'aaaaaaa1-0000-4000-8000-00000000000b', 'Player B');

insert into public.groups (id, event_id, name)
values
  ('22222222-0000-4000-8000-00000000000a', 'eeeeeee1-0000-4000-8000-00000000000a', 'Group A'),
  ('22222222-0000-4000-8000-00000000000b', 'eeeeeee1-0000-4000-8000-00000000000b', 'Group B');

insert into public.event_players (id, event_id, player_id, group_id, group_token)
values
  ('33333333-0000-4000-8000-00000000000a', 'eeeeeee1-0000-4000-8000-00000000000a',
   '11111111-0000-4000-8000-00000000000a', '22222222-0000-4000-8000-00000000000a',
   'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'),
  ('33333333-0000-4000-8000-00000000000b', 'eeeeeee1-0000-4000-8000-00000000000b',
   '11111111-0000-4000-8000-00000000000b', '22222222-0000-4000-8000-00000000000b',
   'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2');

insert into public.scores (id, event_player_id, event_id, hole, strokes)
values
  ('44444444-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-00000000000a',
   'eeeeeee1-0000-4000-8000-00000000000a', 1, 5),
  ('44444444-0000-4000-8000-00000000000b', '33333333-0000-4000-8000-00000000000b',
   'eeeeeee1-0000-4000-8000-00000000000b', 1, 6);

insert into public.side_games (id, event_id, game_type, name)
values
  ('55555555-0000-4000-8000-00000000000a', 'eeeeeee1-0000-4000-8000-00000000000a', 'skins', 'Skins A'),
  ('55555555-0000-4000-8000-00000000000b', 'eeeeeee1-0000-4000-8000-00000000000b', 'skins', 'Skins B');

insert into public.side_game_entries (side_game_id, event_player_id)
values
  ('55555555-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-00000000000a'),
  ('55555555-0000-4000-8000-00000000000b', '33333333-0000-4000-8000-00000000000b');

insert into public.score_audit (score_id, event_player_id, hole, source)
values
  ('44444444-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-00000000000a', 1, 'system'),
  ('44444444-0000-4000-8000-00000000000b', '33333333-0000-4000-8000-00000000000b', 1, 'system');

insert into public.ai_parse_log (event_id, input)
values
  ('eeeeeee1-0000-4000-8000-00000000000a', 'scorecard image a'),
  ('eeeeeee1-0000-4000-8000-00000000000b', 'scorecard image b');

insert into public.email_log (club_id, to_email, subject)
values
  ('aaaaaaa1-0000-4000-8000-00000000000a', 'a@example.com', 'Club A email'),
  ('aaaaaaa1-0000-4000-8000-00000000000b', 'b@example.com', 'Club B email');

insert into public.leagues (id, club_id, name)
values
  ('66666666-0000-4000-8000-00000000000a', 'aaaaaaa1-0000-4000-8000-00000000000a', 'League A'),
  ('66666666-0000-4000-8000-00000000000b', 'aaaaaaa1-0000-4000-8000-00000000000b', 'League B');

insert into public.league_members (league_id, player_id)
values
  ('66666666-0000-4000-8000-00000000000a', '11111111-0000-4000-8000-00000000000a'),
  ('66666666-0000-4000-8000-00000000000b', '11111111-0000-4000-8000-00000000000b');

insert into public.staff_invitations (club_id, email, invited_by, token, expires_at)
values
  ('aaaaaaa1-0000-4000-8000-00000000000a', 'invite-a@example.com',
   '00000000-0000-4000-8000-0000000000a1', '11111111111111111111111111111111', now() + interval '7 days'),
  ('aaaaaaa1-0000-4000-8000-00000000000b', 'invite-b@example.com',
   '00000000-0000-4000-8000-0000000000b1', '22222222222222222222222222222222', now() + interval '7 days');

insert into public.superadmin_audit_log (action, target_type)
values ('test-action-a', 'clubs'), ('test-action-b', 'clubs');

insert into public.pin_attempts (event_id, identifier, attempt_count)
values
  ('eeeeeee1-0000-4000-8000-00000000000a', 'scorer-a', 1),
  ('eeeeeee1-0000-4000-8000-00000000000b', 'scorer-b', 1);

insert into public.rate_limit_state (key, window_start, request_count)
values ('submit_score:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', date_trunc('minute', now()), 5);

insert into public.waitlist (email, name, course_name, state, role)
values ('wl@example.com', 'WL', 'Some Course', 'CA', 'head_pro');

-- ─── players / scorers never authenticate: anon sees nothing ───────────────
set local role anon;

select throws_ok($$select * from public.clubs$$, 42501, 'permission denied for table clubs', 'anon reads no clubs (no grant)');
select throws_ok($$select * from public.events$$, 42501, 'permission denied for table events', 'anon reads no events (no grant)');
select throws_ok($$select * from public.players$$, 42501, 'permission denied for table players', 'anon reads no players (no grant)');
select throws_ok($$select * from public.scores$$, 42501, 'permission denied for table scores', 'anon reads no scores (no grant)');
select throws_ok($$select * from public.event_players$$, 42501, 'permission denied for table event_players', 'anon reads no group tokens (no grant)');
select throws_ok(
  $$insert into public.scores (event_player_id, event_id, hole, strokes)
     values ('33333333-0000-4000-8000-00000000000b',
             'eeeeeee1-0000-4000-8000-00000000000b', 2, 4)$$,
  42501, 'permission denied for table scores',
  'anon cannot write scores directly (no grant, no policy)'
);
select throws_ok(
  $$insert into public.event_players (event_id, player_id, group_token)
     values ('eeeeeee1-0000-4000-8000-00000000000b',
             '11111111-0000-4000-8000-00000000000b',
             'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3')$$,
  42501, 'permission denied for table event_players',
  'anon cannot forge group tokens'
);
select throws_ok(
  $$update public.clubs set name = 'Hacked'$$,
  42501, 'permission denied for table clubs',
  'anon cannot update clubs'
);
select throws_ok(
  $$delete from public.events$$,
  42501, 'permission denied for table events',
  'anon cannot delete events'
);

-- ─── Club A staff: full own-club access ────────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*) from public.clubs where id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their own club'
);
select is(
  (select count(*) from public.clubs where id = 'aaaaaaa1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B (tenant isolation on clubs)'
);
select is(
  (select count(*) from public.profiles where club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their club profiles'
);
select is(
  (select count(*) from public.profiles where club_id = 'aaaaaaa1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B profiles'
);
select is(
  (select count(*) from public.courses where club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their courses'
);
select is(
  (select count(*) from public.courses where club_id = 'aaaaaaa1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B courses'
);
select is(
  (select count(*) from public.holes h
    join public.courses c on c.id = h.course_id
   where c.club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their holes'
);
select is(
  (select count(*) from public.tee_sets ts
    join public.courses c on c.id = ts.course_id
   where c.club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their tee sets'
);
select is(
  (select count(*) from public.events where club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their events'
);
select is(
  (select count(*) from public.events where club_id = 'aaaaaaa1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B events'
);
select is(
  (select count(*) from public.players where club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their players'
);
select is(
  (select count(*) from public.players where club_id = 'aaaaaaa1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B players (roster isolation)'
);
select is(
  (select count(*) from public.groups g
    join public.events e on e.id = g.event_id
   where e.club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their groups'
);
select is(
  (select count(*) from public.groups g
    join public.events e on e.id = g.event_id
   where e.club_id = 'aaaaaaa1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B groups'
);
select is(
  (select count(*) from public.event_players ep
    join public.events e on e.id = ep.event_id
   where e.club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their event players'
);
select is(
  (select count(*) from public.event_players ep
    join public.events e on e.id = ep.event_id
   where e.club_id = 'aaaaaaa1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B group tokens'
);
select is(
  (select count(*) from public.scores s
    join public.events e on e.id = s.event_id
   where e.club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their scores'
);
select is(
  (select count(*) from public.scores s
    join public.events e on e.id = s.event_id
   where e.club_id = 'aaaaaaa1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B scores (leaderboard isolation)'
);
select is(
  (select count(*) from public.score_audit sa
    join public.event_players ep on ep.id = sa.event_player_id
    join public.events e on e.id = ep.event_id
   where e.club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their audit trail'
);
select is(
  (select count(*) from public.side_games sg
    join public.events e on e.id = sg.event_id
   where e.club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their side games'
);
select is(
  (select count(*) from public.side_game_entries sge
    join public.event_players ep on ep.id = sge.event_player_id
    join public.events e on e.id = ep.event_id
   where e.club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their side game entries'
);
select is(
  (select count(*) from public.leagues where club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their leagues'
);
select is(
  (select count(*) from public.league_members lm
    join public.leagues l on l.id = lm.league_id
   where l.club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their league members'
);
select is(
  (select count(*) from public.email_log where club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their email log'
);
select is(
  (select count(*) from public.email_log where club_id = 'aaaaaaa1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B email log'
);
select is(
  (select count(*) from public.ai_parse_log apl
    join public.events e on e.id = apl.event_id
   where e.club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their ai parse log'
);
select is(
  (select count(*) from public.staff_invitations si
   where si.club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their invitations'
);
select is(
  (select count(*) from public.staff_invitations si
   where si.club_id = 'aaaaaaa1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B invitations'
);
select is(
  (select count(*) from public.pin_attempts pa
    join public.events e on e.id = pa.event_id
   where e.club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  1,
  'club A staff read their pin attempt state'
);
select is(
  (select count(*) from public.pin_attempts pa
    join public.events e on e.id = pa.event_id
   where e.club_id = 'aaaaaaa1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B pin state'
);

-- cross-club writes are filtered by with check on insert
select throws_ok(
  $$insert into public.players (club_id, full_name)
     values ('aaaaaaa1-0000-4000-8000-00000000000b', 'Mole')$$,
  '42501', 'new row violates row-level security policy for table "players"',
  'club A staff cannot create players in club B'
);
select throws_ok(
  $$insert into public.events (club_id, course_id, name, start_date, scorer_pin_hash, scorer_pin_salt)
     values ('aaaaaaa1-0000-4000-8000-00000000000b',
             'ccccccc1-0000-4000-8000-00000000000b', 'Stolen', current_date, 'x', 'y')$$,
  '42501', 'new row violates row-level security policy for table "events"',
  'club A staff cannot create events in club B'
);
-- cross-club update/delete silently affect zero rows (using clause)
select is_empty(
  $$update public.players set full_name = 'Hacked'
     where club_id = 'aaaaaaa1-0000-4000-8000-00000000000b'
     returning id$$,
  'club A staff update of club B rows matches nothing'
);
reset role;
select is(
  (select full_name from public.players
    where id = '11111111-0000-4000-8000-00000000000b')::text,
  'Player B',
  'club B player intact after the denied update'
);
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select is_empty(
  $$delete from public.scores
     where event_id = 'eeeeeee1-0000-4000-8000-00000000000b'
     returning id$$,
  'club A staff delete of club B scores matches nothing'
);
reset role;
select is(
  (select count(*) from public.scores
    where event_id = 'eeeeeee1-0000-4000-8000-00000000000b')::int,
  1,
  'club B score intact after the denied delete'
);
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- own-club writes succeed
select results_eq(
  $$insert into public.players (club_id, full_name)
     values ('aaaaaaa1-0000-4000-8000-00000000000a', 'New A Member')
     returning full_name$$,
  array['New A Member'],
  'club A staff can add players to their own club'
);
select results_eq(
  $$update public.events set name = 'Event A Renamed'
     where id = 'eeeeeee1-0000-4000-8000-00000000000a'
     returning name$$,
  array['Event A Renamed'],
  'club A staff can rename their own event'
);

-- ─── audit trail is append-only: staff cannot rewrite history ─────────────
select throws_ok(
  $$update public.score_audit set old_strokes = 99
     where event_player_id = '33333333-0000-4000-8000-00000000000a'$$,
  '42501', 'permission denied for table score_audit',
  'staff cannot update the audit trail (no update grant)'
);
select throws_ok(
  $$delete from public.score_audit
     where event_player_id = '33333333-0000-4000-8000-00000000000a'$$,
  '42501', 'permission denied for table score_audit',
  'staff cannot delete from the audit trail (no delete grant)'
);

-- ─── clubs are read-only for staff: creation is a server-side concern ──────
select throws_ok(
  $$insert into public.clubs (name, slug)
     values ('Rogue Club', 'rogue')$$,
  '42501', 'permission denied for table clubs',
  'staff cannot create clubs (no insert grant)'
);
select throws_ok(
  $$update public.clubs set name = 'Hijacked'
     where id = 'aaaaaaa1-0000-4000-8000-00000000000a'$$,
  '42501', 'permission denied for table clubs',
  'staff cannot update their club row (no update grant)'
);

-- ─── a signed-in stranger with no club sees nothing but their profile ─────
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select is_empty(
  $$select * from public.clubs$$,
  'a clubless authenticated user reads no clubs'
);
select is_empty(
  $$select * from public.events$$,
  'a clubless authenticated user reads no events'
);
select is_empty(
  $$select * from public.players$$,
  'a clubless authenticated user reads no players'
);
select throws_ok(
  $$insert into public.players (club_id, full_name)
     values ('aaaaaaa1-0000-4000-8000-00000000000a', 'Freeloader')$$,
  '42501', 'new row violates row-level security policy for table "players"',
  'a clubless authenticated user cannot write into a club'
);

-- profiles: a stranger cannot read club staff rows, only their own
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select is(
  (select count(*) from public.profiles)::int,
  1,
  'club A staff sees only their own club profile (+ own unclaimed row none)'
);

-- ─── superadmin gate: only profiles.is_superadmin sees cross-club ─────────
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select is(
  (select count(*) from public.clubs)::int,
  2,
  'superadmin reads all clubs'
);
select is(
  (select count(*) from public.events)::int,
  2,
  'superadmin reads all events'
);
select is(
  (select count(*) from public.superadmin_audit_log)::int,
  2,
  'superadmin reads the audit log'
);
select results_eq(
  $$insert into public.superadmin_audit_log (action, target_type)
     values ('impersonate', 'profiles')
     returning action$$,
  array['impersonate'],
  'superadmin can append audit rows'
);

-- but a normal staff member cannot touch the superadmin audit log
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select is_empty(
  $$select * from public.superadmin_audit_log$$,
  'staff cannot read the superadmin audit log'
);
select throws_ok(
  $$insert into public.superadmin_audit_log (action)
     values ('forge')$$,
  '42501', 'new row violates row-level security policy for table "superadmin_audit_log"',
  'staff cannot forge audit rows'
);

-- ─── service_role crosses tenants (trusted server code) ────────────────────
set local role service_role;

select is(
  (select count(*) from public.clubs)::int,
  2,
  'service_role reads all clubs across tenants'
);
select is(
  (select count(*) from public.scores)::int,
  2,
  'service_role reads all scores across clubs'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- staff cannot see rate-limit internals of other clubs (empty by design)
select is_empty(
  $$select * from public.rate_limit_state where key <> 'submit_score:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'$$,
  'rate limit state rows of other clubs are invisible to staff'
);

select * from finish();
rollback;
