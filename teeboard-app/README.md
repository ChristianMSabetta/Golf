# TeeBoard

## Project Overview

TeeBoard is a live golf scoring platform for courses, golf pros, and players: real-time leaderboards, digital scorecards, and WHS/USGA handicap-aware scoring in a single product. This repository is the monolith — it serves the landing/marketing page, the admin/staff app, and the public player/spectator pages.

## Tech Stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript (strict), React Server Components
- **UI:** Tailwind CSS v4, shadcn/ui, lucide-react; Fraunces headings, Inter body text, tabular-nums numeric display; brand green `#0F5132`, gold accent `#C9A227`, cream background `#FAF8F3`; dark palette reserved for the future TV broadcast mode
- **Database:** Supabase Postgres (us-east-1) with Row Level Security and Realtime — full Phase 1 schema in place (see [Data Model](#data-model))
- **Validation:** Zod schemas shared client/server
- **Auth:** Supabase Auth (magic link + password) via `@supabase/ssr`; sessions carried through cookies across server components, client components, and middleware
- **Email:** Resend (via the adapter in `src/lib/email/resend-adapter.ts`)
- **Booking:** Cal.com inline embed (event type configured in the Cal.com dashboard)
- **Hosting:** Vercel Pro iad1, co-located with the managed Supabase Postgres in us-east-1

## Prerequisites

- Node.js 20 or later
- npm 10 or later
- A Supabase project (Postgres, us-east-1)
- A Resend account and API key
- A Cal.com account (booking embed)

## Installation

```bash
npm install
cp .env.example .env.local
```

Set the values in `.env.local` (see [Environment Variables](#environment-variables)). For the booking embed to render, `NEXT_PUBLIC_CALCOM_EVENT_LINK` must point at a configured Cal.com event type (see [Cal.com embed](#calcom-embed)).

### Supabase migration

Apply the migrations in order to your Supabase project: open the Supabase dashboard SQL Editor (or use the Supabase CLI against a linked project) and run each file in `supabase/migrations/`:

1. `20260101000000_create_waitlist_table.sql` — the Phase 0 `waitlist` table plus an insert-only RLS policy for the anon role (signups in, nothing out).
2. `20260101000100_create_phase1_schema.sql` — the full Phase 1 schema (see [Data Model](#data-model)).
3. `20260101000200_enable_rls_policies.sql` — explicit per-role grants and cross-club isolation policies on every table (see [Row Level Security](#row-level-security)).
4. `20260101000300_event_wizard_drafts.sql` — the event wizard's round-structure columns plus the `shamble` scoring format (M4-T003); no policy changes — the Phase 1 events policies already isolate drafts per club.
5. `20260101000400_ai_parse_log_club.sql` — the `ai_parse_log` columns attributing every AI call to the club (M4-T004) for the rate limit.
6. `20260101000500_event_groups_shotgun.sql` — the Groups step's `groups.starting_hole`/`groups.cart_number` columns plus the unique `(event_id, starting_hole)` index (M4-T006); no policy changes — the Phase 1 groups policies already isolate groups per club.
7. `20260101000600_event_extras_publish.sql` — the Extras & publish step (M4-T007): `events.short_code`/`welcome_message`/`is_public`/`published_at`, the `event_flights` and `event_sponsors` tables (both club-isolated through their event, policies per the Phase 1 conventions), the `side_games` kinds (`closest_to_pin`, `long_drive`, `longest_putt`) plus `hole_value` for skins, and the public-read `sponsor-logos` Storage bucket with club-prefix-scoped write policies.

Row Level Security is enabled on every table with explicit per-role grants (see [Row Level Security](#row-level-security)): `anon` gets nothing except the waitlist insert, `authenticated` (= club staff) is isolated to its own club's rows on every table, and superadmin access is gated by `profiles.is_superadmin`. The only anon write path is the `submit_score` RPC (granted `execute` to `anon`/`authenticated`), a `security definer` function with an empty `search_path` that validates a 32-char crypto-random group token and rate-limits writes to 60 requests/minute per token. Cross-club isolation is proven by the automated pgTAP suites in `supabase/tests/` (see [Testing the database](#testing-the-database)).

### Resend wiring

1. Create a Resend API key (dashboard → API keys) and set it as `RESEND_API_KEY`.
2. Set `ADMIN_NOTIFY_EMAIL` to the address that should receive signup notifications.
3. Verify a sending domain in Resend and set `SENDER_EMAIL` to an address on that domain.

Each waitlist signup performs exactly one Resend call: a notification to `ADMIN_NOTIFY_EMAIL`. No confirmation email is ever sent to the visitor. If the Resend call fails, the failure is logged server-side and never blocks the signup.

### Cal.com embed

The "Book a 15-min call" section renders through the Cal.com inline embed. The embed itself needs no code changes — everything booking-related is configured in the Cal.com dashboard, and the link is swapped via `NEXT_PUBLIC_CALCOM_EVENT_LINK`.

Dashboard setup steps (performed once by an operator):

1. **Create the event type.** In the Cal.com dashboard: Event Types → New. Title it "15-min call"; set the duration to **15 minutes**.
2. **Set availability.** Set the event's availability window to **Mon–Fri, 15:00–22:00 (Europe/Rome)**. Create the availability under Availability → New if a suitable schedule doesn't exist yet, then assign it to the event type.
3. **Add the required booking question.** Event Types → your event → Booking Questions → Add → Short answer. Label it **"Which course are you with?"** and mark it **Required**.
4. **Owner-calendar routing.** The event type must be hosted by the owner account (or the team member whose calendar should receive bookings), so bookings land on that owner's connected calendar. Connect the calendar under Apps → Calendars if it isn't already.
5. **Copy the event-type link.** From the event type page, copy the booking link (e.g. `https://cal.com/USERNAME/15-min`) and set it as `NEXT_PUBLIC_CALCOM_EVENT_LINK` locally and in the hosting environment. The embed accepts the full URL or the `USERNAME/EVENT-TYPE` path.
6. **Test the booking flow end to end** through the embedded widget on the deployed page (pick a slot → answer "Which course are you with?" → confirm) and confirm the booking appears on the owner's calendar.

## Environment Variables

All configuration is environment-driven; nothing is hardcoded in components.

### Branding

| Variable | Scope | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_PRODUCT_NAME` | client + server | Product name shown across the app (read via `src/lib/brand.ts`) |
| `NEXT_PUBLIC_PRODUCT_DOMAIN` | client + server | Public product domain used in links and metadata |
| `SENDER_EMAIL` | server | Sender address for outgoing transactional email |
| `NEXT_PUBLIC_LOGO_URL` | client + server | Logo URL (served from `/public` or a CDN) |

### Supabase

| Variable | Scope | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase project URL (dashboard → Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Public anon key for player-facing `submit_score` RPC calls and Supabase Auth sessions; RLS deny-by-default keeps every table unreachable except via the RPC |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Service-role key for trusted server operations (first-run club provisioning, profile reads for role checks, `pin_attempts` lockout state); bypasses RLS and must never be exposed client-side |

### Resend

| Variable | Scope | Description |
| --- | --- | --- |
| `RESEND_API_KEY` | server | API key for the Resend email service (dashboard → API keys) |
| `ADMIN_NOTIFY_EMAIL` | server | Address receiving exactly one notification per waitlist signup |

### Cal.com

| Variable | Scope | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_CALCOM_EVENT_LINK` | client + server | Cal.com event-type link for the embedded 15-minute booking widget (full URL or `USERNAME/EVENT-TYPE` path). When unset or unusable, the booking section is hidden instead of rendering a broken embed |

### Claude (AI event setup)

| Variable | Scope | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | server | Anthropic API key powering the one-sentence AI event setup (M4-T004): a single Claude Haiku call (temperature 0) whose output is Zod-validated before it pre-fills the wizard. Required for the AI pre-fill; without it the card answers the graceful fallback |
| `CLAUDE_MODEL` | server | Model override for the AI event-setup adapter; defaults to Claude Haiku |

### Testing

| Variable | Scope | Description |
| --- | --- | --- |
| `POSTGRES_URL` | server (tests only) | Connection string of a throwaway plain Postgres 15+ for the pgTAP RLS suites via `npm run test:rls` (see [Testing the database](#testing-the-database)); on Supabase use `supabase test db` instead. No Supabase secrets go here |

## Data Model

The full schema lives in `supabase/migrations/20260101000100_create_phase1_schema.sql`: **21 domain tables plus 2 server-side security state tables**, all with Row Level Security enabled. Types are Postgres enums (`staff_role`, `tee_gender`, `event_status`, `scoring_format`) with check constraints and foreign keys throughout.

### Row Level Security

Policies arrive in `supabase/migrations/20260101000200_enable_rls_policies.sql` as three explicit layers:

- **Grants first.** Policies can only filter rows, so every table revokes all privileges from `anon`/`authenticated` and grants back the minimum surface each role needs (`service_role` keeps full access everywhere — it bypasses RLS and never leaves the server). `anon` holds nothing except the waitlist insert; players and scorers never get an auth account and never see a table path.
- **Per-operation policies.** `authenticated` (= club staff) gets `select`/`insert`/`update`/`delete` policies per table, all filtering on club membership via the row's `club_id` (or the club inherited through `courses`/`events`/`event_players`/`leagues`). Child tables like `holes` or `event_players` inherit their club through the parent, so a policy on `players` and one on `holes` use the same predicate root. Append-only tables (`score_audit`, `superadmin_audit_log`) get no `update`/`delete` grants at all — the audit trail cannot be rewritten from any client.
- **Helper predicates.** Policies call `private._is_staff_of(club)`, `private._is_superadmin()` and friends instead of inlining `select … from profiles` — a `security definer` function cannot re-enter (or be blocked by) the RLS of the table the calling policy guards, so policies never recurse. `execute` on the helpers is revoked from `public`/`anon` and granted only to `authenticated`/`service_role`.

Super-admin access is gated by `profiles.is_superadmin` (a dedicated policy per table, never a client-supplied role claim). Tenant roots are stricter still: `clubs` is read-only for staff (first-run club creation and owner re-linking are server-side operations via the service role), and `profiles` self-signup can only create a fresh `event_manager` profile tied to one's own `auth.users` row with `club_id null` — role and superadmin flag are never client-writable.

`rate_limit_state` has no authenticated read policy at all (RPC-only state), and `pin_attempts` is read/update-only for the owning club's staff with inserts service-role-only — the 5-strikes/10-minutes lockout logic itself lands with the authorization layer (M2-T003).

### Tenant & staff

| Table | Purpose |
| --- | --- |
| `clubs` | Tenant root: name, slug, logo, primary color, timezone; plan/billing columns (`plan`, `billing_status`, `stripe_customer_id`) exist only as data model — **no billing logic in any request path** (pilots run free). The logo/primary-color/timezone columns are the **single source of club branding** consumed by the admin app today and by leaderboards, PDF scorecards, and transactional email in later phases (resolved through `resolveClubBrand` in `src/lib/brand.ts`) |
| `profiles` | Staff/admin users mapped 1:1 to `auth.users`; five-role model via `staff_role` enum + `is_superadmin` flag; one owner per club enforced by partial unique index |
| `staff_invitations` | Data model only (Phase 1): club, email, role, token, expiry, status — invitation **flows** land in Phase 3 |
| `superadmin_audit_log` | Data model only (Phase 1): actor, action, target, JSONB metadata — impersonation **logic** lands in Phase 3 |

### Course data

| Table | Purpose |
| --- | --- |
| `courses` | Per-club course (9 or 18 holes) |
| `holes` | Per-course hole number, par, stroke index, yards |
| `tee_sets` | Tee name/color/gender with course rating + slope (WHS inputs) |

### Events & play

| Table | Purpose |
| --- | --- |
| `events` | Per-club event with `event_status` (`draft → scheduled → live → completed → archived`) and scorer PIN columns (`scorer_pin_hash`/`scorer_pin_salt`). M4-T003 adds the wizard's round structure: `holes_count` (9/18), `nine_option` (front/back), `rounds` (1–2), `start_type` (`tee_times`/`shotgun`). M4-T007 adds the publish surface: `short_code` (unique 6-char public/TV slug, partial unique index), `welcome_message`, `is_public`, `published_at` |
| `event_formats` | Formats per event (`stroke_play`, `stableford`, `match_play`, … — `shamble` added in M4-T003); one primary per event via partial unique index. The wizard's Format step settings live on the primary row: `team_size`, `scoring_basis`, `handicap_allowance_pct`, `max_score_rule`, `max_score_fixed_cap`, `tiebreak_method` |
| `players` | Club-level golfer with `handicap_index`, `whs_number` (WHS/USGA scoring inputs) |
| `groups` | Playing groups per event (foursomes / tee times) with a unique `(event_id, name)`; M4-T006 adds the wizard Groups step's `starting_hole` (shotgun start, unique per event via partial index) and `cart_number` |
| `event_players` | One entry per player per event: `group_token` (32-char crypto-random hex, the only player credential), `tee_set_id`, `course_handicap`, `revoked_at` |

### Scoring

| Table | Purpose |
| --- | --- |
| `scores` | Hole-by-hole strokes, unique per `(event_player_id, hole)`; **`client_ts`** (device wall-clock) + `server_ts` for offline conflict resolution — the RPC never lets a stale replay overwrite a newer write |
| `score_audit` | Append-only audit trail of every score mutation (source: `player_token`/`scorer_pin`/`staff`/`system`) |
| `side_games`, `side_game_entries` | Optional per-event side games (`skins`, `dots`, `nassau`, `wolf`, `vegas`) and their participants. M4-T007 adds the Extras step's kinds (`closest_to_pin`, `long_drive`, `longest_putt`) and `hole_value` — the skins per-hole value the carryover math in `@teeboard/scoring` consumes |
| `event_flights` | Handicap-threshold flights per event (M4-T007): `name`, `max_handicap` (null = open top), `position` — the exact shape `@teeboard/scoring`'s `assignFlights` consumes at scoring time |
| `event_sponsors` | Sponsor logos per event (M4-T007): `name`, `logo_path` (Supabase Storage object under the club-scoped `sponsor-logos` bucket), `position` (0–7, max 8) |

### Operations & logs

| Table | Purpose |
| --- | --- |
| `ai_parse_log` | Claude Haiku scorecard-parse attempts: input, JSONB output, validated flag, latency |
| `email_log` | Outbound transactional email (Resend) records |
| `leagues`, `league_members` | Season leagues and memberships |
| `waitlist` | Phase 0 landing-page signups (insert-only for anon) |

### Server-side security state

| Table | Purpose |
| --- | --- |
| `rate_limit_state` | Fixed-window counters; `submit_score` uses the per-token bucket `submit_score:<token>` at 60 requests/minute |
| `pin_attempts` | Scorer PIN failure counters + `locked_at` per `(event_id, identifier)`; the 5-strikes/10-minute lockout check lands with the authorization layer in M2-T003 |

### submit_score(token, hole, strokes, client_ts)

The security-definer RPC (`security definer set search_path = ''`) is the **only** write path a group token can reach: execute is revoked from `public` and granted solely to `anon`/`authenticated`/`service_role`, while every table has RLS enabled with explicit policies so direct table writes from any client raise RLS violations. In order it enforces:

1. **Token shape** — 32-char lowercase hex (`^[0-9a-f]{32}$`), matching the `event_players.group_token` constraint; tokens are crypto-random values, never derived from user input.
2. **Token → live entry** — the token must resolve to an `event_players` row that is not revoked, on an event that is `scheduled` or `live` (completion or archival blocks further writes).
3. **Rate limit** — 60 requests/minute per token via an atomic `insert … on conflict` upsert on `rate_limit_state`; the 61st call raises `errcode = 'PT429'`, which PostgREST surfaces as **HTTP 429 Too Many Requests**.
4. **Bounds** — `strokes` 1–20; `hole` 1–`holes_count` from the event's course (defaults 18).
5. **Offline conflict resolution** — the upsert is guarded by `client_ts`: a replay with an older `client_ts` than the stored row is recorded in `score_audit` but **never overwrites** the newer score.

Every mutation (accepted or stale-rejected) appends a `score_audit` row, and the RPC returns JSON `{accepted, hole, strokes, stale, event_player_id}`.

## Authentication & Authorization

Supabase Auth handles staff/admin sign-in with **both magic link and password** flows (`@supabase/ssr` carries the session through cookies):

- **Server components / route handlers / server actions** — `getRequestSupabase()` (`src/lib/supabase/server.ts`) builds a request-bound client from the request cookies; refreshed cookies persist back into the response.
- **Client components** — `getBrowserSupabase()` (`src/lib/supabase/client.ts`) carries the session for Supabase Auth calls from the browser.
- **Middleware** — `updateSession()` (`src/lib/supabase/middleware.ts`) refreshes the session on every request so pages render with a current session on first paint; the nonce-based CSP (unchanged) is applied alongside it in `src/middleware.ts`.
- **Shared Zod schemas** — `src/lib/auth/schema.ts` validates the sign-in, magic-link, and first-run sign-up payloads identically on client and server (the same module backs both the forms and the server actions).

**First run:** a new owner signing up (`/sign-up`) is provisioned server-side (`src/lib/auth/first-run.ts`) — a club row is created, the owner profile linked to it, and the `owner` role assigned by the server. Client payloads never carry roles; the `superadmin` role and `is_superadmin` flag are never client-writable (RLS enforces it at the database level).

**Five-role model** (`src/lib/auth/authorization.ts`, all checks server-side):

| Role | Credential | Path |
| --- | --- | --- |
| owner / head_pro / event_manager | Supabase Auth account | `requireStaffRole(roles)`, `authorizeStaffForClub(clubId, roles)` — the role is read from the `profiles` row, never from the client |
| super-admin | `profiles.is_superadmin` | `requireSuperadmin()` — the flag is database-only, never a client claim |
| scorer | event PIN only — **no Supabase Auth user, ever** | `verifyScorerPin()` (`src/lib/scorer/pin.ts`) |
| player | 32-char group token only — **no account at all** | the `submit_score` RPC (see [Data Model](#data-model)) |

**Scorer PIN lockout** (`verifyScorerPin`): a reusable server-side authorization primitive — no scorer-facing UI ships in this milestone (the `/e/[shortCode]/score` page arrives in Phase 4). It verifies the PIN against the event's salted hash (`sha256(`${salt}:${pin}`)`, constant-time) with state stored server-side in `pin_attempts`: **5 failed attempts lock the `(event_id, identifier)` pair for 10 minutes**; a successful verification resets the counter. Only the service-role client may insert or reset `pin_attempts` rows (staff RLS is read/update, `anon` has no privileges at all), so lockout state can never be forged or cleared from a browser. The `scorer_pin_lockout.test.sql` pgTAP suite proves the state machine and its grants.

## Admin App

The authenticated admin app lives under `src/app/admin/` and is **server-side protected end to end**: the admin layout (`src/app/admin/layout.tsx`) authenticates every admin request through `requireStaff()` before any content renders — an unauthenticated or insufficient-role visitor is redirected to `/sign-in` before the page streams. The shell renders the section navigation (Dashboard, Courses, Events, Players, Club settings) plus the top bar with the club identity and sign-out.

- **Dashboard (`/admin`)** — post-sign-in landing for owners and staff: the signed-in identity and role plus the club summary (name, timezone, contact) read server-side from the database.
- **Club settings (`/admin/settings`)** — club profile editing (name, logo URL, primary color, timezone) validated by the shared Zod schema (`src/lib/club/schema.ts`) on both client and server. Saves run through the `updateClubProfile` server action, which re-authorizes server-side (owners and head pros only) and persists via the service-role client because `clubs` is read-only under RLS — the tenant root is only ever written by trusted server code. Success revalidates the admin layout so the new branding renders immediately.
- **Courses (`/admin/courses`, `/admin/courses/new`, `/admin/courses/[id]`) — M4-T001** — the full scorecard editor for club staff:
  - **Scorecard grid** — par (3–6), stroke index, and yards per hole for 9- or 18-hole courses; a 9-hole course is the front (1–9) or back (10–18) nine, so 9-hole events play from the same course data.
  - **Validations with field-level errors** — the shared Zod contract (`src/lib/course/schema.ts`) runs identically in the editor form and the `saveCourse` server action: stroke indexes must form a unique permutation of 1–18 (1–9 for 9-hole courses) — duplicates are reported naming both conflicting holes, and missing values are listed explicitly; the par total must be 54–90 for 18 holes and 27–45 for 9 (a live total shows under the grid); slope must be 55–155 and course rating 50–80 per tee (at most one decimal), and two tees of the same gender can't share a name (mirroring the `tee_sets` unique constraint).
  - **Tees** — per-gender (men's/women's) rating and slope definitions; these are the WHS course-handicap inputs consumed at event time via `@teeboard/scoring`.
  - **Paste from scorecard** — the parser (`src/lib/course/parse-scorecard.ts`) turns typical printed/scorecard text into grid rows for confirmation: positional columns (`1 4 401 7`), labeled rows (`Hole 1 Par 4 380 yards SI 7` — either label order), tab/comma/pipe separators, 2–4 columns, headers, totals lines, and prose are all tolerated; junk lines are skipped, and the parsed grid still validates through the same schema before anything saves.
  - **Data path** — reads go through the request-bound client so RLS applies; the `saveCourse`/`deleteCourse` server actions re-authorize server-side (owner/head pro/event manager), enforce the club filter on every service-role write (the service role bypasses RLS, so the tenant guard is in the `.eq("club_id", …)` filters), write the three tables in a deliberate order (course → holes → tee_sets), and refuse to delete a course referenced by any event (`events.course_id` is `on delete restrict`). The editor's display-only par-total math lives in `src/lib/course/totals.ts`, outside the no-scoring-math guard's scope (see [The no-scoring-math guard](#the-no-scoring-math-guard)) — all WHS/USGA scoring math stays in `src/lib/scoring`.
- **Players (`/admin/players`, M4-T002)** — the club player database:
  - **Searchable, sortable table** — name, email, handicap index, event count, and last event played; search matches name/email/phone/WHS number and sorting rides the URL query (`q`, `sort`, `dir`) so the server component re-renders with server-side filtering. Reads go through the request-bound client so RLS applies; event aggregates load through the same policies via `events!inner`.
  - **Inline handicap edit** — clicking the HI cell turns it into a validated input (`src/lib/players/schema.ts`: one decimal, −5…54 mirroring the `players` check constraint) that saves immediately through the role-gated `updateHandicap` server action.
  - **CSV import/export** — `importPlayers` parses pasted or uploaded CSV (headers auto-detected; renamed columns like "Golfer Name", "HI", "WHS #" map automatically; headerless positional files fall back to name/email/phone/gender/HI/WHS), validates every row with the shared Zod schema, and upserts keyed on (name, email) so re-importing updates instead of duplicating; per-row errors are flagged by source line number. `exportPlayers` serializes the same canonical columns. Round-trip is covered by tests.
  - **Duplicate detection & merge** — players sharing the same name AND email are grouped (`src/lib/players/duplicates.ts`, pure) and surfaced in a panel plus row flags. One click merges via the `mergePlayers` server action: blank keeper fields are backfilled from the source, `event_players` rows are re-pointed at the keeper (or dropped where the keeper already holds a slot — `event_players` is unique per event+player), and the source row is deleted — event history and score references survive through the re-pointed entries. All writes are service-role with the club filter enforced in every `.eq("club_id", …)`.

**Club branding** flows from one place: `resolveClubBrand` (`src/lib/brand.ts`) resolves a club's stored settings into a typed `ClubBrand` (name, logo URL, normalized `#RRGGBB` primary color, IANA timezone), falling back to the env-var-backed product defaults for anything unset. No component hardcodes a club name, color, or logo. Staff management (invitations, plan limits) and super-admin surfaces arrive in Phase 3.

- **Event wizard (`/admin/events`, `/admin/events/new`) — M4-T003** — the 5-step event creation framework:
  - **Step registry & gating** — the wizard's five steps (Basics, Format, Players, Groups & teams, Extras & publish — all implemented through M4-T007) are declared in one registry (`src/lib/events/schema.ts`); navigation is free to any unlocked or previously visited step, and each step unlocks only once its predecessors validate (Extras additionally requires at least one saved group, because publishing mints a token per group). Validation is the shared Zod contract running identically client- and server-side, so progression blocks on exactly what the autosave action enforces.
  - **Autosave** — every step persists through role-gated server actions (`src/lib/events/actions.ts`): the first valid Basics save creates the `events` draft row; later saves update it and upsert the primary `event_formats` row. Values autosave debounced client-side, so a draft survives a refresh with all entered data. Drafts carry a crypto-random unpublished PIN hash (the Phase 1 columns are NOT NULL; the real PIN is chosen and rotated atomically at publish in M4-T007).
  - **Basics step** — event name, date, course (picked from the club's course editor), 9 or 18 holes (front/back nine for 9), 1–2 rounds, and tee-times vs. shotgun start.
  - **Format step** — the five scoring formats (stroke play, scramble, best ball, Stableford, shamble), team size (1–4, individual formats locked to 1), gross/net/both scoring, handicap allowance percentage, maximum-score rule (WHS net double bogey default for stroke play/best ball), and the USGA card-off tiebreak. **Defaults derive from the WHS allowances in `@/lib/scoring`** (`WHS_DEFAULT_ALLOWANCE_PCT` maps the Rule 5.5 constants — 95% individual, 85% four-ball), so the wizard pre-fills exactly what the scoring engine assumes.
  - **Players step (`M4-T005`)** — three input paths merged into one confirmed preview before anything saves:
    - **CSV/Excel import** — paste or upload the spreadsheet's CSV export; columns are detected automatically by the shared parser (`src/lib/players/csv.ts`), so shuffled or renamed headers ("Golfer Name", "HI", "E-mail", "WHS #") map with **no manual column selection** — a typical 120-row file imports as-is.
    - **Pick from the club database** — searchable, checkbox list of the club's players (reads through the request-bound client so RLS applies).
    - **Add one by hand** — name + handicap index are enough; email/phone/gender/WHS # optional, validated by the same shared schema.
    - **Preview & flagging** — every staged row shows in a table before commit; rows failing validation (invalid email, missing name, out-of-range handicap) are flagged individually by source line with actionable messages, and any row can be unchecked to skip it. The same person arriving by two paths resolves to one preview row (keyed on name + email, matching the M4-T002 duplicate detector), and rows already attached to the event are marked.
    - **Commit** — `saveEventRoster` (`src/lib/players/roster-actions.ts`) re-validates every row, upserts new/updated players into the club player database with the club filter on every write, and attaches each to the event by inserting an `event_players` row with a fresh crypto-random `group_token` (32-char hex, matching the schema check). Attach is **idempotent** — a player already in the event is skipped, so re-running an import never duplicates.
    - **Detach** — `removeEventPlayer` drops one `event_players` row (the club player row stays); draft events only, enforced server-side.
  - **Groups & teams step (`M4-T006`)** — pair the field and persist it against the Phase 1 `groups` + `event_players.group_id` rows:
    - **Auto-pairing strategies** (`src/lib/events/pairing.ts`, pure) — random (seeded, reshuffles per click), balance-by-handicap (a serpentine draft: team *i* takes the *i*-th lowest with the *i*-th highest, so no team owns the extremes), sorted (consecutive handicap bands), and manual (everything unassigned). Groups always respect the Format step's team size, with the remainder landing on the last group (odd counts never split a player).
    - **Drag-and-drop** — native HTML5 DnD (`draggable` + `dataTransfer`) moves players between groups and the unassigned pool, persisted through `saveGroupsStep` (`src/lib/events/groups-actions.ts`). No DnD dependency and no per-move reflow — a 120-player field stays responsive.
    - **Shotgun holes** — when the Basics step chose a shotgun start, each group gets a unique starting hole from the event's played holes (1–18, or just the front/back nine on a 9-hole event), enforced by the unique `(event_id, starting_hole)` index from `20260101000500_event_groups_shotgun.sql` plus server-side validation. More groups than holes surface a warning rather than a silent overlap; tee-times events hide the field.
    - **Cart numbers** — an editable 1–99 cart number per group, persisted on the `groups` row.
    - **Persistence** — `saveGroupsStep` clears the previous groups first (their names would collide with the planned ones — `groups` is unique per event + name — and the deletion nulls every `event_players.group_id`), then inserts the planned groups and re-points the members. The persisted shape always matches the editor exactly; a mid-save failure leaves the event consistent (everyone unassigned) and retryable. Role-gated (`owner`/`head_pro`/`event_manager`), club-filtered, draft-only, and the step's numbers must agree with the event's Basics (a stale tab cannot save an old plan onto changed basics).
  - **Extras & publish step (`M4-T007`)** — flights, side games, payouts, sponsors, the welcome message, and the publish transition:
    - **Flights** — a small ladder editor (add/remove, A/B/C labels via `flightLabel`): rising `max_handicap` thresholds with the last flight open (`null`) as the top. The state is the exact shape `@teeboard/scoring`'s `assignFlights` consumes; no assignment math lives in the step.
    - **Side games** — checkboxes for the four games (skins, closest to pin, long drive, longest putt) with a per-hole value on skins; validation demands a value on enabled skins and none elsewhere, and the save replaces only the step's four `side_games` kinds (rows of any other kind stay untouched).
    - **Payouts** — the standard presets (50/30/20, 60/30/10, 40/30/20/10) with a purse; the presets are share data from `@teeboard/scoring`'s `PAYOUT_PRESET_50_30_20` and all tie-splitting math stays in the package.
    - **Sponsor logos** — up to 8 logos per event (PNG/JPEG/WebP/SVG, ≤ 2 MB) uploaded through `uploadEventSponsor`, into the public-read `sponsor-logos` Storage bucket at `<club_id>/<event_id>/<uuid>.<ext>` — the Storage policies scope writes by that club prefix, so club A can never touch club B's objects. Logos render in the step from the bucket's public CDN URL.
    - **Welcome message & visibility** — a ≤ 2000-character message for the player surfaces and the `is_public` toggle that gates the public leaderboard/TV URLs for strangers.
    - **Publish** — `publishEvent` (`src/lib/events/extras-actions.ts`) transitions the draft in **one atomic update**: `status → scheduled`, a unique 6-char short code (collision-checked, ambiguous glyphs excluded), the **rotated salted 4-digit scorer PIN** (replacing the placeholder hash the draft carried), `published_at`, and `is_public`. It then re-mints every attached player's `group_token` — a fresh 32-char crypto-random hex per group member (`node:crypto`, never `Math.random`). The clear PIN is returned exactly once (it is unrecoverable from the salted hash) and presented with **copyable shareable links**: public leaderboard (`/e/<code>`), TV (`/e/<code>/tv`), and scorer entry (`/score` + the PIN). Publishing requires players and at least one saved group; a failure leaves the event a draft with its old credentials, retryable.
  - **RLS** — reads run through the request-bound client and writes through the service-role client with the club filter in every `.eq("club_id", …)`; the Phase 1 events policies keep draft events invisible outside the owning club. The wizard's columns arrive in `20260101000300_event_wizard_drafts.sql` (plus the `shamble` enum value) and the Groups step's in `20260101000500_event_groups_shotgun.sql`; no policy changes were needed.
- **Event admin (`/admin/events/[id]`) — M4-T008** — where staff land after the wizard: the tabbed management surface over the live event (`src/lib/events/admin.ts` + `src/lib/events/admin-actions.ts`), reading through the request-bound client so every query stays inside the signed-in club's RLS:
  - **Tabs** — Overview, Players, Groups, and Settings, declared in one registry (`EVENT_ADMIN_TABS`) and deep-linkable via `?tab=`; the panels arrive as server-rendered React nodes so the tab switch is a cheap client toggle with no data refetch.
  - **Overview** — the event status and day (course, holes, rounds, start type), the live counters (players attached, groups persisted, scores recorded), and the copyable shareable links from publish — public leaderboard (`/e/<code>`), TV (`/e/<code>/tv`), and scorer entry (`/score` + the PIN, which is stored only as a salted hash and shown once at publish).
  - **Players** — the event roster with each player's email, handicap index, and group, plus a quick remove (draft events only — the remove action is refused server-side past publish; a published event's roster is the day's actual field). The handicap index itself is edited on the club player page, keeping one source of truth per player.
  - **Groups** — the read-only composition view: each group's members (with HI), shotgun starting hole, and cart number, plus the unassigned pool. Group editing lives in the wizard (drafts).
  - **Settings & the mid-event safeguard** — the editable configuration (name, date, holes, rounds, start type, the format block through tiebreak, welcome message, visibility) validated by the shared `eventSettingsSchema` (`src/lib/events/admin.ts`, unit-tested in `admin.test.ts`). Changing the **scoring format on a live (published) event requires typing `CHANGE`** — the client reveals a confirmation input that unlocks the save button, and `saveEventSettings` re-checks the guard server-side (a tampered client that skips the input cannot apply the change). Drafts change freely.
  - **Quick actions** — **Duplicate** (`duplicateEvent`: a full copy into a new draft — event row, primary format, flights, side games, sponsors, groups, and roster with fresh 32-char crypto-random group tokens; statuses, short code, PIN, and scores never copy), **Archive** (`archiveEvent`: published events only — scheduled/live → archived), and **Delete** (`deleteEvent`), which is **restricted to draft events server-side**: the delete filters `.eq("status", "draft")` with a `count: "exact"` check, so a manipulated request naming a published event deletes nothing and the UI's draft-only button is a convenience, not the safeguard.
  - **Events list** — `/admin/events` links drafts back into the wizard and every published event to its admin page.
  - **AI one-sentence setup (`M4-T004`)** — the "Describe it in one sentence" card at the top of the wizard turns a free-text description into pre-fill data: `POST /api/admin/events/ai-parse` makes a single Claude Haiku call (temperature 0, 8-second abort budget) whose output is Zod-validated (`src/lib/ai/schema.ts`) against the wizard's own step enums before anything pre-fills. The adapter (`src/lib/ai/claude-adapter.ts` → the pure call core in `src/lib/ai/messages.ts`) reads only `ANTHROPIC_API_KEY`/`CLAUDE_MODEL` from the environment — no SDK or key ever reaches a component. Safeguards, all server-side: a 30-calls/day/club rate limit derived by counting the current day's `ai_parse_log` rows attributed to the club (the schema is frozen — no rate-limit tables), every call logged to `ai_parse_log` (input, output, validated flag, model, error, latency) in `20260101000400_ai_parse_log_club.sql`, and a graceful fallback that answers "Couldn't read that" with a null prefill on invalid output, timeout, provider failure, or a missing key — leaving the wizard exactly as it was. The **AI never writes to the database** — its only footprint is the log row, and nothing pre-fills until the user saves. Prefilled fields carry an 'Auto-filled' badge until the user touches that field.

## Running the Project

```bash
npm run dev        # development server at http://localhost:3000
npm run build      # production build (runs the no-scoring-math guard first)
npm run start      # serve the production build
npm run lint       # no-scoring-math guard + ESLint
npm run guard:scoring-boundary        # the no-scoring-math guard alone
npm run guard:scoring-boundary:prove # demonstrate the guard fails on an intentional violation
npm run test:rls   # pgTAP RLS/isolation suites (see Testing the database)
npm run test:scoring          # lib/scoring Vitest verification suite (see The scoring package)
npm run test:scoring:coverage # the suite + v8 coverage, ≥95% lines/branches enforced
```

## Testing the database

The pgTAP suites under `supabase/tests/` prove the tenant-isolation guarantees automatically:

- `rls_grants.test.sql` — structural: RLS enabled on all 23 tables, explicit policies on every one, `anon` holds no privileges beyond the waitlist insert, `service_role` full access, `submit_score` execution granted to exactly `anon`/`authenticated`/`service_role`.
- `rls_isolation.test.sql` — seeds two complete clubs (A and B) with owners, courses, events, players, groups, scores, side games, leagues, logs, and PIN state, then asserts on **every table** that club A's staff can read/write only club A's rows, that cross-club reads return nothing, that cross-club writes are denied or match zero rows (with the target row proven intact afterward), that the audit trails are append-only, and that superadmin reach is gated on `profiles.is_superadmin`.
- `submit_score_rpc.test.sql` — token validity (unknown, malformed, non-hex), bounds, revocation and event-completion invalidation, `client_ts` conflict resolution (a stale replay never overwrites a newer score), and the 60 req/min per-token rate limit surfacing as `PT429` (HTTP 429), including per-token budget isolation.
- `scorer_pin_lockout.test.sql` — the scorer PIN lockout state machine on `pin_attempts`: per-`(event_id, identifier)` rows, upsert-on-conflict semantics, the 5-failure lockout timestamp, success-driven resets, and the grants matrix (staff cannot insert lockout state; `anon` cannot read any).
- `ai_parse_log_club.test.sql` — the M4-T004 club attribution on `ai_parse_log`: the nullable `club_id` column and its `(club_id, created_at desc)` rate-limit index, legacy null-attributed rows staying valid, and staff reading only their own club's rows through the Phase 1 policy set.

Run them against your configured Supabase instance:

```bash
supabase test db        # on Supabase (pgTAP provisioned by the platform)
```

or against any plain Postgres 15+ (CI or laptop) with `psql` on PATH:

```bash
npm run test:rls       # uses POSTGRES_URL (see Environment Variables)
```

The runner creates a throwaway scratch database, applies `scripts/rls-bootstrap.sql` (an idempotent no-op on Supabase: it only stubs the `anon`/`authenticated`/`service_role` roles, the `auth.users` table, and `auth.uid()`, which the platform provides) plus all migrations in filename order, runs the suites, and drops the scratch database again — nothing is left behind.

## The scoring package

All WHS/USGA scoring mathematics lives in the pure TypeScript package at `src/lib/scoring/` — no I/O, no environment reads, no framework, database, or browser APIs; every input (course data, handicap indices, allowances, caps, payout splits, side-game settings) is an explicit function parameter. This is the architectural home of all scoring math (rule C13): pages and components consume the package, they never reimplement it.

- **Handicap layer (M3-T001)** — Course/Playing Handicap computation (Rules of Handicapping 5.1/5.2/5.5/5.6, plus handicaps, Committee overrides) and per-hole stroke allocation.
- **Competition layer (M3-T002)** — scorecards under maximum-score rules (net double bogey per RoH 3.3b, fixed caps), the five formats (stroke play, scramble, best ball, stableford, shamble) with WHS allowance defaults and configurable team sizes, USGA card-off tiebreaks (last 9/6/3, then hole-by-hole backwards), flights from explicit thresholds, payouts with the 50/30/20 preset and correct tie splitting (ties combine the spanned positions and split the combined amount — redistribution, never duplication), and side games (skins with carryover, closest-to-pin, long drive, longest putt). Calcutta and parimutuel side games are excluded on legal-risk grounds (constraint C24).
- **Verification suite (M3-T003)** — the full Vitest suite in `src/lib/scoring/test/`: spec cases (e.g. HI 12.4 @ SR 128 / CR 71.2 / par 72 → CH 13 → PH 12) plus 40+ edge cases (9-hole modes, plus handicaps, tie-splitting at every position, carryover chains, card-off hole-by-hole, max-score interactions, empty/partial cards). Expected values are hand-derived from the cited rules, never mirrored from the implementation; ≥95% line/branch coverage is enforced by `npm run test:scoring:coverage`.

Usage, the exported API, and the WHS verification policy (formula constants, Rules of Handicapping clause citations, and the change procedure) are documented in [`src/lib/scoring/README.md`](src/lib/scoring/README.md).

## The integration proof page (M3-T004)

The Phase 2 proof that the whole pipeline runs end to end lives at **`/proof/leaderboard`**:

```bash
npm run dev        # then open http://localhost:3000/proof/leaderboard
# or
npm run build && npm run start   # production build, then the same URL
```

- The page renders the **committed static fixture** of a seeded event — [`src/lib/leaderboard/fixture.ts`](src/lib/leaderboard/fixture.ts): a full championship course (pars, stroke indices, CR/SR per tee), a nine-player field spanning scratch to 20.8 (including a plus handicap), shotgun-start groups, and a complete 18-hole score set per player.
- Gross and net standings are **computed client-side through `@/lib/scoring` only** — the component code never does scoring arithmetic itself; the position-change movement arrows come from the package's movement module (`computePositionMovements`), so even the standings arithmetic lives inside the package.
- **Position movement is visibly proven by simulation:** press "Apply simulated score update" and the same seed data is updated in memory (Devon Clarke's closing hole 18 goes 5 → 3), every total is recomputed through the package, and the movement arrows render the position changes (gross: Clarke ↑1 / Raghavan ↓1 into a tie; net: Clarke ↑1 / Kowalczyk ↓1). Press again to reset to the seeded standings — the arrows recompute both ways.
- **Deliberately free of Phase 4 machinery** — no Realtime subscription, no polling, no Supabase client, no database read. The fixture file is the page's only data source, so the milestone boundary stays intact.

## The no-scoring-math guard

The rule "scoring math lives only in `src/lib/scoring`" (C13) is enforced **mechanically**, not by review convention. `scripts/guard-scoring-boundary.mjs` parses every page and component file (`src/app/**`, `src/components/**`) with the TypeScript AST and fails when it finds:

1. **Arithmetic on scoring-domain values** — `+ - * / % ** += -= *= /= %=`, unary sign (`-score`), or `++`/`--` (prefix and postfix) applied to any score, stroke, handicap, par, points, standings, position, payout, or flight identifier (e.g. `net - par`, `totalGross += 1`, `row.score++`).
2. **Deep imports bypassing the package entry** — `@/lib/scoring/src/handicap` or any other specifier that reaches past `@/lib/scoring` into the package internals.

The guard runs in **`npm run lint` and `npm run build`** — so the same single command that builds the project in CI also enforces the boundary, and no scoring arithmetic can reach production. To run just the guard: `npm run guard:scoring-boundary`.

**The guard is proven, not assumed** (a guard that never fails is worse than no guard):

```bash
npm run guard:scoring-boundary:prove
```

plants an intentional violation (a component computing `net - par`), asserts the guard **exits non-zero**, removes it, and asserts the guard passes on the clean tree — verifying both the failure and the recovery. `src/lib/scoring/` itself, `src/lib/leaderboard/fixture.ts` (seed data), and all test files are outside the guarded scope, so the package can compute freely.

## Project Structure

```
src/
  app/
    (landing)/       # landing/marketing route group (layout + page)
    (auth)/          # sign-in + sign-up pages (magic link & password)
    proof/leaderboard/  # Phase 2 integration proof page (seeded fixture,
                     #  computed client-side through lib/scoring — see
                     #  "The integration proof page")
    admin/
      layout.tsx     # server-authenticated admin shell (nav + top bar)
      page.tsx       # post-sign-in dashboard (club summary, get-started)
      courses/       # course manager (M4-T001): list page + new/[id] editor —
                     # 9/18-hole scorecard grid, tees w/ rating+slope,
                     # paste-from-scorecard parser
      events/         # event manager: list page + new/ wizard (M4-T003..T007,
                     #  5-step framework w/ per-step Zod gating + autosave +
                     #  publish minting short code/PIN/tokens) + [id]/ admin
                     #  page (M4-T008): tabbed Overview/Players/Groups/Settings
                     #  w/ typed-CHANGE format-edit safeguard + quick actions
      players/       # club player database (M4-T002): searchable table with
                     # inline handicap edits, CSV import/export, duplicate merge
      settings/      # club profile settings page (server component + form)
    auth/callback/   # magic-link code → session exchange (server-side)
    api/waitlist/    # POST route handler validating waitlist signups (Zod)
    api/health/      # readiness probe (Supabase round-trip; 503 when down)
                     #  └─ live/ liveness probe (process-up only, no deps)
    layout.tsx       # root layout: fonts (Fraunces/Inter) and metadata
    globals.css      # Tailwind theme: brand design tokens and dark TV palette
  components/
    admin/           # admin shell: nav, top bar, sign-out, club profile form
                     # course-editor/ — scorecard grid + tees + paste parser (M4-T001)
                     # event-wizard/ — 5-step wizard framework (M4-T003): step rail,
                     #  Basics + Format forms w/ debounced autosave + Zod gating,
                     #  Players step (M4-T005): CSV/club-picker/manual paths →
                     #  merged deduped preview w/ per-row flags → idempotent attach,
                     #  Groups step (M4-T006): pairing strategies + native HTML5
                     #  drag-and-drop + shotgun holes + cart numbers,
                     #  Extras & publish step (M4-T007): flights + side games +
                     #  payout presets + sponsor uploads (club-scoped Storage) +
                     #  welcome message + publish → short code, per-group tokens,
                     #  4-digit scorer PIN, copyable shareable links
                     # event-admin/ — tabbed Overview/Players/Groups/Settings
                     #  surface (M4-T008): status + counters + copyable
                     #  publish links, roster w/ quick remove, read-only
                     #  groups view, settings w/ typed-CHANGE format-change
                     #  confirmation, quick actions (Duplicate → new draft,
                     #  Archive, draft-only Delete enforced server-side)
                     # players/ — table w/ search+sort+inline HI edit, CSV panel,
                     #  duplicate merge panel (M4-T002)
    auth/            # sign-in + sign-up forms (useActionState server actions)
    landing/         # landing sections: header, hero, demo video slot, pricing,
                     # Cal.com booking section + inline embed, waitlist, footer
    proof/           # Phase 2 proof components: leaderboard standings table,
                     # header (branding from lib/brand only — no hardcoded names)
    ui/              # shadcn/ui primitives (button, card, input, label, select …)
  lib/
    auth/
      schema.ts      # shared client/server Zod schemas (sign-in, magic link, sign-up, scorer PIN)
      authorization.ts  # server-side five-role model & club-scoped role gates
      first-run.ts   # first-run club creation + owner profile provisioning (service role)
      actions.ts     # server actions: password/magic-link sign-in, sign-out, owner sign-up
    brand.ts         # env-var-backed brand config + resolveClubBrand (club branding single source)
    cal-embed/       # Cal.com embed loader and event-link normalization
    club/
      schema.ts      # shared client/server Zod schema for club profile settings
      server.ts      # club row loader via the request client (RLS-scoped reads)
      actions.ts     # updateClubProfile server action (role-gated, service-role write)
    course/
      schema.ts      # shared client/server Zod schemas: scorecard grid (par/SI/
                     #  yards, unique-permutation stroke indexes, 9/18 par totals),
                     #  tees (rating 50–80, slope 55–155, per-gender)
      parse-scorecard.ts  # paste-from-scorecard text parser → grid rows
      totals.ts      # display-only aggregates (live par total) — outside the
                     #  no-scoring-math guard scope
      field-errors.ts # Zod issue → field-error lookup flattening
      server.ts      # RLS-respecting course/holes/tee_sets reads
      actions.ts     # saveCourse/deleteCourse server actions (role-gated,
                     #  club-filtered service-role writes, delete blocked when
                     #  an event references the course)
      course.test.ts # Vitest suite: schema bounds + parser variants
    events/
      schema.ts      # shared client/server Zod contracts (M4-T003): the wizard
                     #  step registry, Basics + Format steps, WHS default
                     #  allowances derived from @/lib/scoring
      wizard.ts      # pure step logic: validation gating, navigation, completion
                     #  marking, DB-row → draft mappers (+ wizard.test.ts suite)
      pairing.ts     # pure Groups-step logic (M4-T006): pairing strategies
                     #  (random/balance/sorted/manual), shotgun hole assignment,
                     #  cart handling, drag-drop move semantics, plan validation,
                     #  payload contract (+ pairing.test.ts suite)
      server.ts      # RLS-respecting event list + draft loading + groups/grouped
                     #  roster reads (M4-T006)
      actions.ts     # saveBasicsStep/saveFormatStep server actions (role-gated,
                     #  club-filtered service-role writes, draft-only edits)
      groups-actions.ts # saveGroupsStep (M4-T006): delete-then-insert group replace —
                     #  clear previous groups (unique names + nulls members),
                     #  insert planned groups, re-point event_players.group_id;
                     #  validated server-side
      extras.ts       # pure Extras-step logic (M4-T007): flights, side games
                     #  (skins value), payout presets (from @teeboard/scoring
                     #  data), sponsors, welcome message, row ↔ state mappers
                     #  (+ extras.test.ts suite)
      publish.ts     # pure publish logic (M4-T007): short-code alphabet +
                     #  generators (byte-source injected), 4-digit scorer PIN,
                     #  32-hex group token, shareable link builders
                     #  (+ publish.test.ts suite)
      extras-actions.ts # saveExtrasStep/uploadEventSponsor/removeEventSponsor/
                     #  publishEvent server actions (role-gated, club-filtered,
                     #  draft-only; publish mints short code + rotated salted
                     #  PIN + per-group tokens atomically)
       admin.ts        # pure event-admin logic (M4-T008): the tab registry, the
                      #  CHANGE confirmation guard for live format edits, the
                      #  settings Zod contract (+ admin.test.ts suite)
       admin-actions.ts # saveEventSettings/duplicateEvent/archiveEvent/deleteEvent
                      #  server actions (role-gated, club-filtered; the CHANGE
                      #  guard enforced server-side; delete filters status=draft)
    players/
      schema.ts      # shared client/server Zod schemas: player rows, inline
                     #  handicap edits (−5…54, one decimal), CSV import rows,
                     #  list/search/sort params
      csv.ts         # pure CSV parse (auto header mapping, quoted fields) +
                     #  serializer (canonical export columns)
      roster.ts      # pure Players-step logic (M4-T005): CSV/picker/manual →
                     #  staged entries, shared validation, cross-path dedupe,
                     #  skip-aware commit plan, group-token generation
                     #  (+ roster.test.ts suite: 120-row shuffled import, flags)
      duplicates.ts   # pure duplicate grouping (name+email) + merge-keeper pick
      server.ts      # RLS-respecting player reads + event aggregates + dup scan
                     #  + roster loaders (club players, event attachments)
      actions.ts     # updateHandicap / importPlayers (upsert, per-row errors) /
                     #  exportPlayers / mergePlayers (event-history-preserving)
      roster-actions.ts # saveEventRoster (re-validate, club-filtered upserts,
                     #  idempotent event attach w/ crypto-random group tokens) /
                     #  removeEventPlayer — both role-gated + draft-only
      players.test.ts # Vitest suite: handicap + CSV round-trip + duplicate logic
    scorer/
      pin.ts         # server-side scorer PIN verification + 5-strikes/10-min lockout primitive
      pin-hash.ts    # canonical salted-hash recipe for scorer PINs (shared with event creation)
    scoring/         # @teeboard/scoring — pure WHS/USGA scoring math package (see
                     #  src/lib/scoring/README.md): the single home of all scoring
                     #  computations — handicap layer + competition layer (formats,
                     #  max scores, tiebreaks, flights, payouts, side games) +
                     #  standings movement
    leaderboard/
      fixture.ts     # committed static fixture of the seeded event (course, field,
                     #  groups, complete scores) — the proof page's only data source
    us-states.ts     # US state codes/names for the waitlist state selector
    email/
      resend-adapter.ts  # email adapter boundary around the Resend SDK
    supabase/
      server.ts      # server-only clients: service-role + request-bound (anon key) + staff auth context
      middleware.ts  # per-request Supabase session refresh (called from src/middleware.ts)
      client.ts      # browser client for client components
    waitlist/
      schema.ts      # Zod signup schema + success-message copy (shared client/server)
      server.ts      # Supabase insert + admin notification (exactly one per signup)
    utils.ts         # shared helpers (cn)
  middleware.ts      # Supabase session refresh + nonce-based Content-Security-Policy
supabase/
  migrations/        # versioned SQL migrations applied to the Supabase project
                     # (Phase 0 waitlist, Phase 1 full schema incl. submit_score
                     #  RPC, Phase 1 RLS grants + cross-club isolation policies)
  tests/             # pgTAP suites: RLS grants matrix, cross-club isolation,
                     # submit_score RPC, scorer PIN lockout
                     # (run via `supabase test db` or test:rls)
scripts/
  rls-bootstrap.sql  # idempotent test bootstrap (roles, auth.uid(), pgtap) —
                     # a no-op on Supabase, a shim for plain Postgres
  run-rls-tests.mjs  # scratch-database runner for supabase/tests (test:rls)
  guard-scoring-boundary.mjs  # no-scoring-math AST guard (lint + build; see
                     # "The no-scoring-math guard")
  verify-scoring-guard.mjs    # guard-effectiveness proof (guard:scoring-boundary:prove)
public/              # static assets (logo.svg)
```

Later phases add sibling route groups — `(player)` for the public scoring pages — keeping each surface cleanly separated under `src/app/`. The staff/admin routes live under `admin/` and the `(auth)` group.

## Deployment

The app is **containerizable and stateless**: one Next.js server process, no local persistent storage, every configuration value and external link (Cal.com, Resend, admin notify address, Supabase keys) supplied through environment variables. All persistent data lives in the managed Supabase Postgres (us-east-1); the compute tier can be swapped (Vercel, Docker on any cloud, a container platform) without data-model changes.

### Vercel (primary)

The landing page deploys on Vercel (Pro, iad1 region) with every environment variable from `.env.local` set in the project's Vercel settings:

1. Import the repository into Vercel (framework preset: Next.js; region: iad1).
2. In the project → Settings → Environment Variables, add every variable listed in [Environment Variables](#environment-variables) for the Production environment.
3. Deploy; the landing page serves the complete Phase 0 experience at the assigned production URL.
4. Verify against the deployed URL: a waitlist signup persists a row in Supabase and sends the admin notification, and a Cal.com booking completes end to end through the embed.

Deployment verification checklist (run against the live URL after each deploy):

- The page renders hero, pricing, demo video slot, booking section, and waitlist form.
- A waitlist signup returns "Thanks — I'll reach out within 24 hours.", inserts a row into the Supabase `waitlist` table, and sends one notification to `ADMIN_NOTIFY_EMAIL`.
- A booking through the Cal.com embed completes and appears on the owner's calendar.
- `GET /api/health/live` answers `200 {"status":"alive",...}`.
- `GET /api/health` answers `200 {"status":"healthy","checks":{"config":true,"database":true},...}` and the response includes the `Content-Security-Policy` header.

### Docker (portable)

The same image runs on any container platform (Cloud Run, ECS, Fly.io, a plain Docker host):

```bash
docker build -t teeboard-app .
docker run --rm -p 3000:3000 --env-file .env.local teeboard-app
```

The multi-stage `Dockerfile` builds Next.js with `output: "standalone"` (a self-contained bundle, no build tooling in the runtime image), runs as a non-root user, and exposes a single foreground Node process on `PORT` (default `3000`). No secrets are baked into the image — the same image promotes across environments; only the environment variables change.

### Health endpoints

| Endpoint | Purpose | Behavior |
| --- | --- | --- |
| `GET /api/health/live` | Liveness | `200 {"status":"alive"}` whenever the Node process is up; touches no backing service, so a Supabase outage never restarts healthy instances. `Cache-Control: no-store`. |
| `GET /api/health` | Readiness | `200 {"status":"healthy","checks":{"config":true,"database":true}}` after a successful Supabase round-trip (head count on `clubs` via the server-side service-role client — RLS grants the anon role nothing, so the request-path client would by design answer 403 on a healthy deployment); `503 {"status":"unhealthy",...}` with the failing check otherwise. Never cached, never authenticated, never exposes secrets (only a head count and latency). |

On Vercel the deployment health dashboard and uptime monitors can point at these endpoints directly. In Docker the image-level `HEALTHCHECK` polls `/api/health/live`.

### Security headers

Every response carries the baseline hardening headers from `next.config.ts` — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security` (2-year `max-age`, HSTS once served over HTTPS), and `Permissions-Policy` denying camera/microphone/geolocation/payment. The per-route **Content-Security-Policy** is applied in `src/middleware.ts`: a per-request nonce is generated and travels both on the request headers (`x-nonce` + a request `Content-Security-Policy` header, where Next.js extracts it during SSR and applies it to the `<script>` tags it renders) and on the response CSP header (which the browser enforces). `strict-dynamic` + the nonce allow Next.js bootstrap scripts while the policy stays locked down; Cal.com and `*.supabase.co` are the only external script/connect/frame/img sources, `object-src`/`base-uri`/`form-action` are locked to `'self'`, `frame-ancestors 'none'`, and HTTPS upgrades are enforced in production. Because each request carries its own nonce, every matched route renders dynamically (see `src/app/layout.tsx`). The policy never blocks the booking embed or the Supabase Realtime connections; Resend is called server-side only and needs no browser sources.

## Hard Stop — Day-3 Validation Gate (go/no-go)

**Non-negotiable: the build halts here.** Phase 1 (foundations: full schema, RLS, auth, admin skeleton, deployment/security posture) is complete. **No Phase 2 work — and no scoring-engine work of any kind — may begin until the day-3 validation decision is recorded.**

The 3-day head-pro outreach runs against the deployed landing page — the tool for the round. During outreach: share the deployed URL with prospects (optionally with `?utm_source=...` — the value is captured and stored with each signup); every signup lands in the `waitlist` table with email, name, course, state, role, source, and timestamp, and triggers one notification to `ADMIN_NOTIFY_EMAIL` so no lead is missed; prospects book the 15-min call directly through the embedded Cal.com widget, and bookings appear on the owner's calendar with the course name answered from the required question.

On day 3, the go/no-go decision is measured against these success thresholds:

| Threshold | Target | Measured from |
| --- | --- | --- |
| Head-pro contacts | **100 contacts** | Outreach tracker (emails/calls/forms initiated) |
| Conversations | **≥ 10 conversations** | Cal.com bookings completed through the embedded 15-min widget + email replies |
| Pilot events booked | **≥ 3 pilot events booked** | Confirmed commitments with head pros to run a live event |

**Recording the decision (required before any Phase 2 work):** record the measured numbers against the thresholds above, the resulting go/no-go decision, and the date — in the project's decision log (e.g. a pinned issue or the ops doc of record), not in this README. Only after that decision is recorded may Phase 2 (scoring engine) work begin; if it is **no-go**, the build stays stopped and the decision note steers what happens next. This gate is the point of the Phase 1 hard stop: validation happens before any further engineering investment.

US-English conventions apply across every surface rendered so far (pricing in USD — `$129/month`, yards as the course-distance unit in `holes.yards`, and `MM/DD/YYYY` dates on the US Eastern-default timezone calendar via `resolveClubBrand`).
