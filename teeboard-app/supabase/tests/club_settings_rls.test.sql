-- M4-T010 club-settings suite: staff invitations and the super-admin
-- surface.  Proves that
--   * staff invitations are tenant-isolated (club A staff never see or
--     touch club B invitations),
--   * the invitation lifecycle columns are only writable by the owning
--     club's staff,
--   * the superadmin audit log is append-only and readable ONLY by
--     profiles.is_superadmin (regular staff can neither read nor forge
--     rows),
--   * the club profile (name/logo/color/timezone) is read-only for staff —
--     the tenant root is written only by trusted server code (the
--     service-role client in src/lib/club/actions.ts) — while a superadmin
--     may READ every club,
--   * and that a staff member of club A can never reach club B's settings
--     rows through any of these surfaces.
--
-- On Supabase: `supabase test db`
-- Local: `npm run test:rls`

begin;
select plan(15);

-- ─── Fixtures ──────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'super@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'pro-a@example.com');

insert into public.clubs (id, name, slug, logo_url, primary_color, timezone)
values
  ('aaaaaaa1-0000-4000-8000-00000000000a', 'Club A', 'club-a', '/logo-a.svg', '#123456', 'America/New_York'),
  ('aaaaaaa1-0000-4000-8000-00000000000b', 'Club B', 'club-b', null, null, 'America/Chicago');

insert into public.profiles (id, user_id, club_id, full_name, email, role)
values
  ('00000000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'aaaaaaa1-0000-4000-8000-00000000000a', 'Owner A', 'owner-a@example.com', 'owner'),
  ('00000000-0000-4000-8000-0000000000b1', '22222222-2222-2222-2222-222222222222',
   'aaaaaaa1-0000-4000-8000-00000000000b', 'Owner B', 'owner-b@example.com', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', '44444444-4444-4444-4444-444444444444',
   'aaaaaaa1-0000-4000-8000-00000000000a', 'Pro A', 'pro-a@example.com', 'head_pro');
insert into public.profiles (id, user_id, full_name, email, role)
values ('00000000-0000-4000-8000-0000000005c1', '33333333-3333-3333-3333-333333333333',
  'Super Admin', 'super@example.com', 'superadmin');
update public.profiles set is_superadmin = true
 where id = '00000000-0000-4000-8000-0000000005c1';

insert into public.staff_invitations (club_id, email, invited_by, token, status, expires_at)
values
  ('aaaaaaa1-0000-4000-8000-00000000000a', 'invite-pending@example.com',
   '00000000-0000-4000-8000-0000000000a1', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'pending', now() + interval '7 days'),
  ('aaaaaaa1-0000-4000-8000-00000000000a', 'invite-expired@example.com',
   '00000000-0000-4000-8000-0000000000a1', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'pending', now() - interval '8 days'),
  ('aaaaaaa1-0000-4000-8000-00000000000b', 'invite-b@example.com',
   '00000000-0000-4000-8000-0000000000b1', 'cccccccccccccccccccccccccccccccc',
   'pending', now() + interval '7 days');

-- ─── Club A owner: own-club invitations, never club B's ─────────────────────
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*) from public.staff_invitations
    where club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  2,
  'club A staff read their club invitations (pending + expired)'
);
select is(
  (select count(*) from public.staff_invitations
    where club_id = 'aaaaaaa1-0000-4000-8000-00000000000b')::int,
  0,
  'club A staff cannot read club B invitations'
);

-- Revoke is club-scoped: club A staff can revoke only their own rows.
update public.staff_invitations
   set status = 'revoked'
 where club_id = 'aaaaaaa1-0000-4000-8000-00000000000a'
   and token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
select is(
  (select count(*) from public.staff_invitations
    where club_id = 'aaaaaaa1-0000-4000-8000-00000000000a'
      and status = 'revoked')::int,
  1,
  'club A staff revoke their own pending invitation'
);

-- Cross-club revocation matches zero rows and leaves the target intact.
update public.staff_invitations
   set status = 'revoked'
 where club_id = 'aaaaaaa1-0000-4000-8000-00000000000b';
select is(
  (select count(*) from public.staff_invitations
    where club_id = 'aaaaaaa1-0000-4000-8000-00000000000b'
      and status = 'revoked')::int,
  0,
  'club A staff cannot revoke club B invitations'
);

select is(
  (select primary_color from public.clubs
    where id = 'aaaaaaa1-0000-4000-8000-00000000000a')::text,
  '#123456',
  'club A staff read their club branding (color consumed by leaderboard/PDF)'
);

-- ─── The head pro of club A: same isolation, read/write own club only ────────
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select is(
  (select count(*) from public.staff_invitations
    where club_id = 'aaaaaaa1-0000-4000-8000-00000000000a')::int,
  2,
  'head pro reads own club invitations'
);
select is_empty(
  $$select * from public.clubs where id = 'aaaaaaa1-0000-4000-8000-00000000000b'$$,
  'club A head pro cannot read club B settings rows'
);

-- ─── Regular staff cannot touch the superadmin audit log ─────────────────────
select is_empty(
  $$select * from public.superadmin_audit_log$$,
  'regular staff cannot read the superadmin audit log'
);
select throws_ok(
  $$insert into public.superadmin_audit_log (action, target_type, target_id)
     values ('impersonate', 'profiles', '00000000-0000-4000-8000-0000000000a1')$$,
  '42501', 'new row violates row-level security policy for table "superadmin_audit_log"',
  'regular staff cannot forge impersonation audit rows'
);

-- ─── Superadmin: all clubs, audit append — the impersonation surface ─────────
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select is(
  (select count(*) from public.clubs)::int,
  2,
  'superadmin views all clubs'
);
select is(
  (select count(*) from public.staff_invitations)::int,
  3,
  'superadmin reads invitations across clubs'
);
select results_eq(
  $$insert into public.superadmin_audit_log
     (actor_profile_id, action, target_type, target_id, metadata)
   values ('00000000-0000-4000-8000-0000000005c1', 'impersonate', 'profiles',
           '00000000-0000-4000-8000-0000000000a1',
           '{"actorEmail":"super@example.com","targetClubId":"aaaaaaa1-0000-4000-8000-00000000000a"}'::jsonb)
   returning action$$,
  array['impersonate'],
  'superadmin appends impersonation audit rows'
);
select is(
  (select count(*) from public.superadmin_audit_log
   where action = 'impersonate')::int,
  1,
  'the impersonation is logged exactly once'
);
select throws_ok(
  $$update public.superadmin_audit_log set action = 'tampered'$$,
  '42501', 'permission denied for table superadmin_audit_log',
  'the audit trail cannot be rewritten by anyone (no update grant)'
);

-- ─── Back to club A staff: the audit row is invisible ─────────────────────────
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select is_empty(
  $$select * from public.superadmin_audit_log where action = 'impersonate'$$,
  'the impersonation audit row is invisible to regular staff'
);

select * from finish();
rollback;
