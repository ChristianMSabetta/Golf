-- M2-T002 — Phase 1 Row Level Security.
--
-- Cross-club tenant isolation on every table:
--   * anon gets no privileges anywhere except the waitlist insert; players and
--     scorers never get an auth account and never see a table path — the only
--     anon-reachable write is the security-definer submit_score RPC (M2-T001).
--   * authenticated (= club staff with a Supabase Auth account) can read and
--     manage their own club's tenant subtree only: every policy filters on
--     club membership via the club_id column(s) of the row.
--   * superadmin profiles (profiles.is_superadmin) bypass the club filter via
--     a dedicated superadmin policy on each table.
--   * service_role (server-side only, bypasses RLS by Postgres role setting)
--     keeps a broad policy + grants so trusted server code can operate on all
--     tables without depending on RLS internals.

-- ─── 0. Helper predicates ───────────────────────────────────────────────────
-- No policy references another protected table inline, so no policy can
-- re-enter RLS on the table it guards.  SECURITY DEFINER + no grants to
-- PUBLIC makes the helpers unusable except inside policy evaluation (and by
-- the supabase_admin owner).

create schema if not exists private;

create or replace function private._is_superadmin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select p.is_superadmin
       from public.profiles p
      where p.user_id = (select auth.uid())),
    false)
$$;

create or replace function private._is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.user_id = (select auth.uid())
       and p.club_id is not null)
$$;

create or replace function private._is_staff_of(
  club uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.user_id = (select auth.uid())
       and p.club_id = $1)
    or private._is_superadmin()
$$;

-- idempotent safeguard: keep the helpers executable by the platform owners only
revoke execute on function private._is_superadmin() from public;
revoke execute on function private._is_staff() from public;
revoke execute on function private._is_staff_of(uuid) from public;
grant execute on function private._is_superadmin() to authenticated, service_role;
grant execute on function private._is_staff() to authenticated, service_role;
grant execute on function private._is_staff_of(uuid) to authenticated, service_role;

-- ─── 1. Explicit grants ─────────────────────────────────────────────────────
-- Policies can only filter rows; grants decide whether an operation runs at
-- all.  anon gets nothing (except waitlist insert); authenticated gets the
-- minimum surface each table needs.

revoke all on table public.clubs from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.staff_invitations from anon, authenticated;
revoke all on table public.superadmin_audit_log from anon, authenticated;
revoke all on table public.courses from anon, authenticated;
revoke all on table public.holes from anon, authenticated;
revoke all on table public.tee_sets from anon, authenticated;
revoke all on table public.events from anon, authenticated;
revoke all on table public.event_formats from anon, authenticated;
revoke all on table public.players from anon, authenticated;
revoke all on table public.groups from anon, authenticated;
revoke all on table public.event_players from anon, authenticated;
revoke all on table public.scores from anon, authenticated;
revoke all on table public.side_games from anon, authenticated;
revoke all on table public.side_game_entries from anon, authenticated;
revoke all on table public.score_audit from anon, authenticated;
revoke all on table public.ai_parse_log from anon, authenticated;
revoke all on table public.email_log from anon, authenticated;
revoke all on table public.leagues from anon, authenticated;
revoke all on table public.league_members from anon, authenticated;
revoke all on table public.rate_limit_state from anon, authenticated;
revoke all on table public.pin_attempts from anon, authenticated;

-- clubs is read-only for staff: tenant roots are created and re-linked
-- server-side (M2-T003 first-run club creation) via the service role.
grant select on table public.clubs to authenticated;
-- superadmin_audit_log is append-only for authenticated
grant select, insert on table public.superadmin_audit_log to authenticated;
-- score_audit is append-only for authenticated (its trigger writes as owner)
grant select, insert on table public.score_audit to authenticated;
grant select, insert, update, delete on table public.staff_invitations to authenticated;
grant select, insert, update, delete on table public.courses to authenticated;
grant select, insert, update, delete on table public.holes to authenticated;
grant select, insert, update, delete on table public.tee_sets to authenticated;
grant select, insert, update, delete on table public.events to authenticated;
grant select, insert, update, delete on table public.event_formats to authenticated;
grant select, insert, update, delete on table public.players to authenticated;
grant select, insert, update, delete on table public.groups to authenticated;
grant select, insert, update, delete on table public.event_players to authenticated;
grant select, insert, update, delete on table public.scores to authenticated;
grant select, insert, update, delete on table public.side_games to authenticated;
grant select, insert, update, delete on table public.side_game_entries to authenticated;
grant select, insert, update, delete on table public.ai_parse_log to authenticated;
grant select, insert, update, delete on table public.email_log to authenticated;
grant select, insert, update, delete on table public.leagues to authenticated;
grant select, insert, update, delete on table public.league_members to authenticated;
-- server-side security state is owned by the security-definer RPC only
grant select on table public.rate_limit_state to authenticated;
grant select, update on table public.pin_attempts to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select on table public.waitlist to authenticated;
-- the landing page writes signups server-side via service_role; anon insert
-- stays available so the waitlist form keeps working with the anon key.
grant insert on table public.waitlist to anon;
grant all on table public.waitlist to service_role;
grant all on table public.clubs to service_role;
grant all on table public.profiles to service_role;
grant all on table public.staff_invitations to service_role;
grant all on table public.superadmin_audit_log to service_role;
grant all on table public.courses to service_role;
grant all on table public.holes to service_role;
grant all on table public.tee_sets to service_role;
grant all on table public.events to service_role;
grant all on table public.event_formats to service_role;
grant all on table public.players to service_role;
grant all on table public.groups to service_role;
grant all on table public.event_players to service_role;
grant all on table public.scores to service_role;
grant all on table public.side_games to service_role;
grant all on table public.side_game_entries to service_role;
grant all on table public.score_audit to service_role;
grant all on table public.ai_parse_log to service_role;
grant all on table public.email_log to service_role;
grant all on table public.leagues to service_role;
grant all on table public.league_members to service_role;
grant all on table public.rate_limit_state to service_role;
grant all on table public.pin_attempts to service_role;

-- ─── 2. Tenant isolation policies ──────────────────────────────────────────
-- The staff/superadmin pattern repeats per table: the club the profile
-- belongs to owns the row.  Each helper predicate is SECURITY DEFINER with
-- search_path = '' so it cannot re-enter (or be blocked by) the RLS of the
-- table the policy guards.

create policy "service_role full access"
  on public.clubs for all
  to service_role
  using (true)
  with check (true);

-- staff read their own club row; superadmins read all clubs; writes stay
-- service-role only so the tenant root can never be tampered with from a
-- client.  First-run club creation (M2-T003) is a server-side operation.
create policy "staff read own club"
  on public.clubs for select
  to authenticated
  using (
    private._is_superadmin()
    or private._is_staff_of(public.clubs.id)
  );

-- ─── 3. profiles ────────────────────────────────────────────────────────────
-- Every staff member reads the colleague profiles of their club; the signup
-- path can create only a fresh profile for one's own auth user, tied to no
-- club yet.  Role and superadmin flag are never client-writable (M2-T003
-- layers the owner-provisioned role assignment on top).

create policy "service_role full access"
  on public.profiles for all
  to service_role
  using (true)
  with check (true);

create policy "staff read own club profiles"
  on public.profiles for select
  to authenticated
  using (
    private._is_superadmin()
    or (
      private._is_staff()
      and private._is_staff_of(public.profiles.club_id)
    )
    or public.profiles.user_id = (select auth.uid())
  );

create policy "user inserts own signup profile"
  on public.profiles for insert
  to authenticated
  with check (
    public.profiles.user_id = (select auth.uid())
    and public.profiles.club_id is null
    and not public.profiles.is_superadmin
    and public.profiles.role = 'event_manager'
  );

create policy "user updates own signup profile"
  on public.profiles for update
  to authenticated
  using (public.profiles.user_id = (select auth.uid()))
  with check (
    public.profiles.user_id = (select auth.uid())
    -- a self-update can never claim a club, a staff role, or the superadmin
    -- flag: those are provisioned server-side (M2-T003)
    and public.profiles.club_id is null
    and not public.profiles.is_superadmin
    and public.profiles.role = 'event_manager'
  );

create policy "user deletes own profile"
  on public.profiles for delete
  to authenticated
  using (public.profiles.user_id = (select auth.uid()));

-- ─── 4. staff_invitations ────────────────────────────────────────────────────
-- Invitation flows arrive in Phase 3; here the rows are scoped to club staff.

create policy "service_role full access"
  on public.staff_invitations for all
  to service_role
  using (true)
  with check (true);

create policy "staff read own club invitations"
  on public.staff_invitations for select
  to authenticated
  using (private._is_staff_of(public.staff_invitations.club_id));

create policy "staff insert own club invitations"
  on public.staff_invitations for insert
  to authenticated
  with check (private._is_staff_of(public.staff_invitations.club_id));

create policy "staff update own club invitations"
  on public.staff_invitations for update
  to authenticated
  using (private._is_staff_of(public.staff_invitations.club_id))
  with check (private._is_staff_of(public.staff_invitations.club_id));

create policy "staff delete own club invitations"
  on public.staff_invitations for delete
  to authenticated
  using (private._is_staff_of(public.staff_invitations.club_id));

-- ─── 5. superadmin_audit_log ────────────────────────────────────────────────
-- Append-only: superadmins write, superadmins read; no updates or deletes
-- through any policy.

create policy "service_role full access"
  on public.superadmin_audit_log for all
  to service_role
  using (true)
  with check (true);

create policy "superadmin reads audit log"
  on public.superadmin_audit_log for select
  to authenticated
  using (private._is_superadmin());

create policy "superadmin appends audit log"
  on public.superadmin_audit_log for insert
  to authenticated
  with check (private._is_superadmin());

-- ─── 6. courses / holes / tee_sets ──────────────────────────────────────────
-- Course data is club-scoped through courses.club_id; child tables inherit
-- the club of their course.

create policy "service_role full access"
  on public.courses for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club courses"
  on public.courses for all
  to authenticated
  using (private._is_staff_of(public.courses.club_id))
  with check (private._is_staff_of(public.courses.club_id));

create policy "service_role full access"
  on public.holes for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club holes"
  on public.holes for all
  to authenticated
  using (private._is_staff_of((
    select c.club_id
      from public.courses c
     where c.id = public.holes.course_id
  )))
  with check (private._is_staff_of((
    select c.club_id
      from public.courses c
     where c.id = public.holes.course_id
  )));

create policy "service_role full access"
  on public.tee_sets for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club tee sets"
  on public.tee_sets for all
  to authenticated
  using (private._is_staff_of((
    select c.club_id
      from public.courses c
     where c.id = public.tee_sets.course_id
  )))
  with check (private._is_staff_of((
    select c.club_id
      from public.courses c
     where c.id = public.tee_sets.course_id
  )));

-- ─── 7. events / event_formats ──────────────────────────────────────────────

create policy "service_role full access"
  on public.events for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club events"
  on public.events for all
  to authenticated
  using (private._is_staff_of(public.events.club_id))
  with check (private._is_staff_of(public.events.club_id));

create policy "service_role full access"
  on public.event_formats for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club event formats"
  on public.event_formats for all
  to authenticated
  using (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.event_formats.event_id
  )))
  with check (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.event_formats.event_id
  )));

-- ─── 8. players / groups / event_players ─────────────────────────────────────
-- groups.group belongs_to no club directly; it inherits the club through its
-- event.

create policy "service_role full access"
  on public.players for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club players"
  on public.players for all
  to authenticated
  using (private._is_staff_of(public.players.club_id))
  with check (private._is_staff_of(public.players.club_id));

create policy "service_role full access"
  on public.groups for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club groups"
  on public.groups for all
  to authenticated
  using (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.groups.event_id
  )))
  with check (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.groups.event_id
  )));

create policy "service_role full access"
  on public.event_players for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club event players"
  on public.event_players for all
  to authenticated
  using (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.event_players.event_id
  )))
  with check (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.event_players.event_id
  )));

-- ─── 9. scores / score_audit / side_games / side_game_entries ────────────────
-- scores inherit the club through event_players → events.

create policy "service_role full access"
  on public.scores for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club scores"
  on public.scores for all
  to authenticated
  using (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.scores.event_id
  )))
  with check (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.scores.event_id
  )));

create policy "service_role full access"
  on public.score_audit for all
  to service_role
  using (true)
  with check (true);

-- staff may read and append audit rows of their club; updates and deletes are
-- never granted (see grants above: append-only).
create policy "staff read own club audit trail"
  on public.score_audit for select
  to authenticated
  using (private._is_staff_of((
    select e.club_id
      from public.events e
        join public.event_players ep on ep.event_id = e.id
     where ep.id = public.score_audit.event_player_id
  )));

create policy "staff append own club audit trail"
  on public.score_audit for insert
  to authenticated
  with check (private._is_staff_of((
    select e.club_id
      from public.events e
        join public.event_players ep on ep.event_id = e.id
     where ep.id = public.score_audit.event_player_id
  )));

create policy "service_role full access"
  on public.side_games for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club side games"
  on public.side_games for all
  to authenticated
  using (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.side_games.event_id
  )))
  with check (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.side_games.event_id
  )));

create policy "service_role full access"
  on public.side_game_entries for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club side game entries"
  on public.side_game_entries for all
  to authenticated
  using (private._is_staff_of((
    select e.club_id
      from public.events e
        join public.event_players ep on ep.event_id = e.id
     where ep.id = public.side_game_entries.event_player_id
  )))
  with check (private._is_staff_of((
    select e.club_id
      from public.events e
        join public.event_players ep on ep.event_id = e.id
     where ep.id = public.side_game_entries.event_player_id
  )));

-- ─── 10. ai_parse_log / email_log / leagues / league_members ─────────────────

create policy "service_role full access"
  on public.ai_parse_log for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club ai parse log"
  on public.ai_parse_log for all
  to authenticated
  using (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.ai_parse_log.event_id
  )))
  with check (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.ai_parse_log.event_id
  )));

create policy "service_role full access"
  on public.email_log for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club email log"
  on public.email_log for all
  to authenticated
  using (private._is_staff_of(public.email_log.club_id))
  with check (private._is_staff_of(public.email_log.club_id));

create policy "service_role full access"
  on public.leagues for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club leagues"
  on public.leagues for all
  to authenticated
  using (private._is_staff_of(public.leagues.club_id))
  with check (private._is_staff_of(public.leagues.club_id));

create policy "service_role full access"
  on public.league_members for all
  to service_role
  using (true)
  with check (true);

create policy "staff manage own club league members"
  on public.league_members for all
  to authenticated
  using (private._is_staff_of((
    select l.club_id
      from public.leagues l
     where l.id = public.league_members.league_id
  )))
  with check (private._is_staff_of((
    select l.club_id
      from public.leagues l
     where l.id = public.league_members.league_id
  )));

-- ─── 11. Server-side security state ──────────────────────────────────────────
-- rate_limit_state is written exclusively by the security-definer submit_score
-- RPC (owner bypass); authenticated may only observe its own club's rows —
-- practically the empty set, since state rows are not club-owned.

create policy "service_role full access"
  on public.rate_limit_state for all
  to service_role
  using (true)
  with check (true);

-- no authenticated read policy on rate_limit_state: the counters are
-- security-definer RPC state, invisible to every client role (the select
-- grant above is dead without a matching policy, and that is intentional)

-- pin_attempts stores scorer lockout state per event.  Staff of the owning
-- club may read and update the counters (the verification/lockout logic
-- itself lands in M2-T003); inserts and deletes are service-role only.
create policy "service_role full access"
  on public.pin_attempts for all
  to service_role
  using (true)
  with check (true);

create policy "staff read own club pin attempts"
  on public.pin_attempts for select
  to authenticated
  using (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.pin_attempts.event_id
  )));

create policy "staff update own club pin attempts"
  on public.pin_attempts for update
  to authenticated
  using (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.pin_attempts.event_id
  )))
  with check (private._is_staff_of((
    select e.club_id
      from public.events e
     where e.id = public.pin_attempts.event_id
  )));
