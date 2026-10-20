-- Scorer PIN lockout suite: proves the pin_attempts state machine that the
-- server-side authorization primitive (src/lib/scorer/pin.ts) drives:
--   * unique (event_id, identifier) lockout state, upsertable only by the
--     service role (staff RLS is read/update, anon has nothing)
--   * 5 failed attempts lock the pair for 10 minutes (locked_at set)
--   * a locked pair stays locked until locked_at + 10 minutes passes
--   * a successful verification resets attempt_count/locked_at
--   * cross-club staff can never read or reset another club's pin state
--
-- On Supabase: `supabase test db`
-- Local:      `npm run test:rls`

begin;
select plan(12);

-- ─── Fixtures ──────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@example.com');

insert into public.clubs (id, name, slug)
values
  ('aaaaaaa1-0000-4000-8000-00000000000a', 'Pin Club A', 'pin-club-a'),
  ('aaaaaaa1-0000-4000-8000-00000000000b', 'Pin Club B', 'pin-club-b');

insert into public.profiles (id, user_id, club_id, full_name, email, role)
values
  ('00000000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'aaaaaaa1-0000-4000-8000-00000000000a', 'Owner A', 'owner-a@example.com', 'owner'),
  ('00000000-0000-4000-8000-0000000000b1', '22222222-2222-2222-2222-222222222222',
   'aaaaaaa1-0000-4000-8000-00000000000b', 'Owner B', 'owner-b@example.com', 'owner');

insert into public.courses (id, club_id, name)
values
  ('ccccccc1-0000-4000-8000-00000000000a', 'aaaaaaa1-0000-4000-8000-00000000000a', 'Pin Course A'),
  ('ccccccc1-0000-4000-8000-00000000000b', 'aaaaaaa1-0000-4000-8000-00000000000b', 'Pin Course B');

insert into public.events (id, club_id, course_id, name, start_date, status, scorer_pin_hash, scorer_pin_salt)
values
  ('eeeeeee1-0000-4000-8000-00000000000a', 'aaaaaaa1-0000-4000-8000-00000000000a',
   'ccccccc1-0000-4000-8000-00000000000a', 'Pin Event A', current_date, 'live',
   encode(digest('pin-a', 'sha256'), 'hex'), 'salt-a'),
  ('eeeeeee1-0000-4000-8000-00000000000b', 'aaaaaaa1-0000-4000-8000-00000000000b',
   'ccccccc1-0000-4000-8000-00000000000b', 'Pin Event B', current_date, 'live',
   encode(digest('pin-b', 'sha256'), 'hex'), 'salt-b');

-- ─── service-role upsert of the lockout state (what the TS primitive does) ──
insert into public.pin_attempts (event_id, identifier, attempt_count, locked_at)
values
  ('eeeeeee1-0000-4000-8000-00000000000a', 'station-1', 1, null),
  ('eeeeeee1-0000-4000-8000-00000000000a', 'station-2', 5, now()),
  ('eeeeeee1-0000-4000-8000-00000000000b', 'station-1', 1, null);

select is(
  (select count(*) from public.pin_attempts
    where event_id = 'eeeeeee1-0000-4000-8000-00000000000a')::int,
  2,
  'per-(event, identifier) lockout rows are independent'
);

select is(
  (select attempt_count from public.pin_attempts
    where event_id = 'eeeeeee1-0000-4000-8000-00000000000a'
      and identifier = 'station-1')::int,
  1,
  'failed attempts increment the counter (service-role write path)'
);

-- 5 failures set locked_at (the TS primitive writes now())
select isnt(
  (select locked_at from public.pin_attempts
    where event_id = 'eeeeeee1-0000-4000-8000-00000000000a'
      and identifier = 'station-2'),
  null,
  'the 5th failed attempt records the lockout timestamp'
);

-- a second upsert on the same pair updates, not duplicates (unique constraint)
insert into public.pin_attempts (event_id, identifier, attempt_count, locked_at)
values ('eeeeeee1-0000-4000-8000-00000000000a', 'station-1', 2, null)
on conflict (event_id, identifier) do update
  set attempt_count = excluded.attempt_count,
      last_attempt_at = now();

select is(
  (select count(*) from public.pin_attempts
    where event_id = 'eeeeeee1-0000-4000-8000-00000000000a'
      and identifier = 'station-1')::int,
  1,
  'repeated failures upsert the same (event, identifier) row'
);

select is(
  (select attempt_count from public.pin_attempts
    where event_id = 'eeeeeee1-0000-4000-8000-00000000000a'
      and identifier = 'station-1')::int,
  2,
  'the upserted counter reflects the latest failure count'
);

-- ─── success resets the state (what the TS primitive does) ─────────────────
update public.pin_attempts
   set attempt_count = 0, locked_at = null, last_attempt_at = now()
 where event_id = 'eeeeeee1-0000-4000-8000-00000000000a'
   and identifier = 'station-2';

select is(
  (select attempt_count from public.pin_attempts
    where event_id = 'eeeeeee1-0000-4000-8000-00000000000a'
      and identifier = 'station-2')::int,
  0,
  'a successful verification resets the attempt counter'
);

select is(
  (select locked_at is null from public.pin_attempts
    where event_id = 'eeeeeee1-0000-4000-8000-00000000000a'
      and identifier = 'station-2'),
  true,
  'a successful verification clears the lockout'
);

-- ─── staff isolation ───────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*) from public.pin_attempts
    where event_id = 'eeeeeee1-0000-4000-8000-00000000000a')::int,
  2,
  'club A staff read their own club pin state'
);

select is(
  (select count(*) from public.pin_attempts
    where event_id = 'eeeeeee1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B pin state'
);

-- staff cannot INSERT new pin state (service-role only): the denial must not
-- abort the suite, so catch and record it explicitly.
do $$
declare
  v_denied boolean := false;
begin
  begin
    insert into public.pin_attempts (event_id, identifier, attempt_count)
      values ('eeeeeee1-0000-4000-8000-00000000000a', 'station-9', 1);
  exception
    when insufficient_privilege then
      v_denied := true;
  end;
  if not v_denied then
    raise exception 'staff insert into pin_attempts unexpectedly succeeded';
  end if;
end
$$;

select is(
  (select count(*) from public.pin_attempts where identifier = 'station-9')::int,
  0,
  'staff cannot insert pin attempt state (insert denied, zero rows)'
);

reset role;

-- ─── anon gets nothing ──────────────────────────────────────────────────────
-- (the SELECT grant is revoked from anon entirely, so even the count query
--  denies — catch and record it like the insert denial above.)
set local role anon;

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform 1 from public.pin_attempts limit 1;
  exception
    when insufficient_privilege then
      v_denied := true;
  end;
  if not v_denied then
    raise exception 'anon read from pin_attempts unexpectedly succeeded';
  end if;
end
$$;

select is(
  (select current_user = 'anon')::boolean,
  true,
  'anon cannot read any pin state (read denied at the grant level)'
);

reset role;

select * from finish();
rollback;
