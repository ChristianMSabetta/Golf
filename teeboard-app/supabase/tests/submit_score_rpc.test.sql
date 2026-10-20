-- submit_score RPC suite: token validity, token invalidation at event
-- completion and by revocation, bounds, the 60 req/min per-token rate limit,
-- and client_ts conflict resolution.  The RPC is security definer and runs
-- as the schema owner, so it works from any role the function is granted to.
--
-- On Supabase: `supabase test db`
-- Local:      `npm run test:rls`

begin;
select plan(31);

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'rpc-owner@example.com');

insert into public.clubs (id, name, slug)
values ('aaaaaaa1-0000-4000-8000-00000000000a', 'RPC Club', 'rpc-club');

insert into public.courses (id, club_id, name, holes_count)
values ('ccccccc1-0000-4000-8000-00000000000a', 'aaaaaaa1-0000-4000-8000-00000000000a', 'RPC Course', 18);

insert into public.events (id, club_id, course_id, name, start_date, status, scorer_pin_hash, scorer_pin_salt)
values
  ('eeeeeee1-0000-4000-8000-00000000000a', 'aaaaaaa1-0000-4000-8000-00000000000a',
   'ccccccc1-0000-4000-8000-00000000000a', 'RPC Event', current_date, 'live',
   encode(digest('pin', 'sha256'), 'hex'), 'salt'),
  ('eeeeeee1-0000-4000-8000-00000000000c', 'aaaaaaa1-0000-4000-8000-00000000000a',
   'ccccccc1-0000-4000-8000-00000000000a', 'RPC Completed Event', current_date, 'completed',
   encode(digest('pin', 'sha256'), 'hex'), 'salt'),
  ('eeeeeee1-0000-4000-8000-00000000000d', 'aaaaaaa1-0000-4000-8000-00000000000a',
   'ccccccc1-0000-4000-8000-00000000000a', 'RPC Revoked Event', current_date, 'live',
   encode(digest('pin', 'sha256'), 'hex'), 'salt');

insert into public.players (id, club_id, full_name)
values ('11111111-0000-4000-8000-00000000000a', 'aaaaaaa1-0000-4000-8000-00000000000a', 'RPC Player');

insert into public.event_players (id, event_id, player_id, group_token)
values
  ('33333333-0000-4000-8000-00000000000a', 'eeeeeee1-0000-4000-8000-00000000000a',
   '11111111-0000-4000-8000-00000000000a', 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'),
  ('33333333-0000-4000-8000-00000000000c', 'eeeeeee1-0000-4000-8000-00000000000c',
   '11111111-0000-4000-8000-00000000000a', 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3'),
  ('33333333-0000-4000-8000-00000000000d', 'eeeeeee1-0000-4000-8000-00000000000d',
   '11111111-0000-4000-8000-00000000000a', 'd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4');

-- revoke the d4d4 entry's token: revocation must block further writes
update public.event_players set revoked_at = now()
 where id = '33333333-0000-4000-8000-00000000000d';

-- ─── invalid tokens ───────────────────────────────────────────────────────
select throws_ok(
  $$select public.submit_score('f00dcafef00dcafef00dcafef00dcafe', 1::smallint, 4::smallint)$$,
  '22023', 'unknown group token',
  'unknown group token rejected'
);
select throws_ok(
  $$select public.submit_score('f00dcafef00dcafef00dcafef00dcaf', 1::smallint, 4::smallint)$$,
  '22023', 'invalid group token',
  'malformed (31-char) token rejected'
);
select throws_ok(
  $$select public.submit_score('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz1', 1::smallint, 4::smallint)$$,
  '22023', 'invalid group token',
  'non-hex 32-char token rejected'
);

-- ─── bounds ────────────────────────────────────────────────────────────────
select throws_ok(
  $$select public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 1::smallint, 0::smallint)$$,
  '22023', 'strokes out of range',
  'zero strokes rejected'
);
select throws_ok(
  $$select public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 1::smallint, 21::smallint)$$,
  '22023', 'strokes out of range',
  '21 strokes rejected'
);
select throws_ok(
  $$select public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 19::smallint, 4::smallint)$$,
  '22023', 'hole out of range',
  'out-of-range hole rejected on an 18-hole course'
);

-- ─── happy path: anon submits through the RPC ───────────────────────────────
set local role anon;

select is(
  (public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 1::smallint, 4::smallint)
    ->> 'accepted')::boolean,
  true,
  'anon submits a score for a live event via valid token'
);
reset role;
select is(
  (select count(*) from public.scores
    where event_player_id = '33333333-0000-4000-8000-00000000000a'
      and hole = 1)::int,
  1,
  'the RPC wrote exactly one scores row for hole 1'
);
select is(
  (select count(*) from public.score_audit
    where event_player_id = '33333333-0000-4000-8000-00000000000a')::int,
  1,
  'the RPC appended a score_audit row'
);

-- the same call from authenticated also works (score-station use case)
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select is(
  (public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 2::smallint, 5::smallint)
    ->> 'accepted')::boolean,
  true,
  'authenticated submits through the RPC'
);
reset role;

-- ─── token invalidation at event completion ────────────────────────────────
select throws_ok(
  $$select public.submit_score('c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3', 1::smallint, 4::smallint)$$,
  '22023', 'event is not accepting scores',
  'completed events reject further token writes'
);
select is(
  (select count(*) from public.scores
    where event_player_id = '33333333-0000-4000-8000-00000000000c')::int,
  0,
  'no score row was written for the completed event'
);

-- ─── revoked tokens ─────────────────────────────────────────────────────────
select throws_ok(
  $$select public.submit_score('d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4', 1::smallint, 4::smallint)$$,
  '22023', 'group token revoked',
  'revoked token rejected'
);

-- token revocation blocks further writes (owner flips revoked_at)
select lives_ok(
  $$update public.event_players set revoked_at = now()
     where id = '33333333-0000-4000-8000-00000000000a'$$,
  'owner revokes the token'
);
select throws_ok(
  $$select public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 3::smallint, 4::smallint)$$,
  '22023', 'group token revoked',
  'a revoked token can no longer submit'
);

-- ─── event completion invalidates tokens ─────────────────────────────────────
select lives_ok(
  $$update public.event_players set revoked_at = null
     where id = '33333333-0000-4000-8000-00000000000a'$$,
  'owner restores the token'
);
select is(
  (public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 3::smallint, 4::smallint)
    ->> 'accepted')::boolean,
  true,
  'the restored token submits again (live event)'
);
select lives_ok(
  $$update public.events set status = 'completed'
     where id = 'eeeeeee1-0000-4000-8000-00000000000a'$$,
  'owner completes the event'
);
select throws_ok(
  $$select public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 4::smallint, 4::smallint)$$,
  '22023', 'event is not accepting scores',
  'event completion invalidates tokens for further writes'
);
select is(
  (select count(*) from public.scores
    where event_player_id = '33333333-0000-4000-8000-00000000000a'
      and hole = 4)::int,
  0,
  'no score row was written after completion'
);

-- ─── client_ts conflict resolution ──────────────────────────────────────────
select lives_ok(
  $$update public.events set status = 'live'
     where id = 'eeeeeee1-0000-4000-8000-00000000000a'$$,
  'owner reopens the event'
);
select is(
  (public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 5::smallint, 6::smallint,
    now() - interval '2 hours') ->> 'stale')::boolean,
  false,
  'first write for hole 5 is accepted regardless of client_ts'
);
select is(
  (public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 5::smallint, 7::smallint,
    now()) ->> 'stale')::boolean,
  false,
  'a newer client_ts overwrites the stored observation'
);
select is(
  (select strokes from public.scores
    where event_player_id = '33333333-0000-4000-8000-00000000000a'
      and hole = 5)::int,
  7,
  'the newer client_ts won: strokes = 7'
);
select is(
  (public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 5::smallint, 9::smallint,
    now() - interval '1 hour') ->> 'stale')::boolean,
  true,
  'a stale replay is detected'
);
select is(
  (select strokes from public.scores
    where event_player_id = '33333333-0000-4000-8000-00000000000a'
      and hole = 5)::int,
  7,
  'the stale replay did NOT overwrite the newer score'
);

-- ─── rate limit: 60 requests per minute per token ───────────────────────────
-- earlier sections consumed requests from this token's budget; start the
-- window fresh so the count below is exact
delete from public.rate_limit_state
 where key = 'submit_score:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
select is(
  (public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 6::smallint, 4::smallint)
    ->> 'accepted')::boolean,
  true,
  'first write of the minute window succeeds'
);
-- 59 more calls fill the fixed window; each must succeed
do $$
declare
  r jsonb;
begin
  for i in 2..60 loop
    r := public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 7::smallint, 4::smallint);
    if (r ->> 'accepted')::boolean is not true then
      raise exception 'call % inside the window unexpectedly rejected', i;
    end if;
  end loop;
end
$$;
select is(
  (select request_count from public.rate_limit_state
    where key = 'submit_score:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1')::int,
  60,
  'the fixed-window counter reached exactly 60 for the token'
);
select throws_ok(
  $$select public.submit_score('a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 8::smallint, 4::smallint)$$,
  'PT429', 'rate limit exceeded for group token',
  'the 61st request in the window is rate limited (429 to clients)'
);
select is(
  (select count(*) from public.scores
    where event_player_id = '33333333-0000-4000-8000-00000000000a'
      and hole = 8)::int,
  0,
  'the rate-limited write did not land'
);
-- a different token has its own budget (per-token isolation): a second
-- player in the same event carries a distinct group token
insert into public.players (id, club_id, full_name)
values ('11111111-0000-4000-8000-00000000000b', 'aaaaaaa1-0000-4000-8000-00000000000a', 'RPC Player 2');
insert into public.event_players (id, event_id, player_id, group_token)
values ('33333333-0000-4000-8000-00000000000e', 'eeeeeee1-0000-4000-8000-00000000000a',
        '11111111-0000-4000-8000-00000000000b', 'e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5');
select is(
  (public.submit_score('e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5', 1::smallint, 4::smallint)
    ->> 'accepted')::boolean,
  true,
  'per-token isolation: another token has its own budget'
);

select * from finish();
rollback;
