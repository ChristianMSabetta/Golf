# TeeBoard

TeeBoard is a live golf scoring platform for courses, golf pros, and players: real-time leaderboards, digital scorecards, and WHS/USGA handicap-aware scoring in a single product. This repository is the monolith — it serves the landing/marketing page, the admin/staff app, and the public player/spectator pages.

## Tech Stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript (strict), React Server Components
- **UI:** Tailwind CSS v4, shadcn/ui, lucide-react; Fraunces headings, Inter body text, tabular-nums numeric display; brand green `#0F5132`, gold accent `#C9A227`, cream background `#FAF8F3`; dark palette reserved for the future TV broadcast mode
- **Database:** Supabase Postgres with Row Level Security and Realtime (waitlist table live; full schema arrives in Phase 1)
- **Validation:** Zod schemas shared client/server
- **Email:** Resend (via the adapter in `src/lib/email/resend-adapter.ts`)
- **Testing (planned):** Vitest, Playwright, k6, Lighthouse
- **Hosting (target):** Vercel Pro iad1, co-located with managed Supabase Postgres in us-east-1

## Prerequisites

- Node.js 20 or later
- npm 10 or later

## Installation

```bash
npm install
```

Copy the environment template and adjust values for your environment:

```bash
cp .env.example .env.local
```

Apply the database migration to your Supabase project. Create a new Supabase project (Postgres, us-east-1), then run the SQL in `supabase/migrations/20260101000000_create_waitlist_table.sql` via the Supabase dashboard SQL Editor (or the Supabase CLI against a linked project). The migration creates the `waitlist` table with a Row Level Security policy that permits anonymous inserts only — the anon role can add signups but never read, update, or delete rows. Waitlist signups are written server-side with the service-role key (which bypasses RLS); the insert-only anon policy covers unauthenticated direct-client flows and defense in depth.

## Environment Variables

All configuration is environment-driven; nothing is hardcoded in components.

### Branding (active now)

| Variable | Scope | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_PRODUCT_NAME` | client + server | Product name shown across the app (read via `src/lib/brand.ts`) |
| `NEXT_PUBLIC_PRODUCT_DOMAIN` | client + server | Public product domain used in links and metadata |
| `SENDER_EMAIL` | server | Sender address for outgoing transactional email (used from the waitlist-notification task on) |
| `NEXT_PUBLIC_LOGO_URL` | client + server | Logo URL (served from `/public` or a CDN) |

### Supabase (active — waitlist persistence)

| Variable | Scope | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase project URL (dashboard → Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Supabase anonymous key; pairs with the insert-only RLS policy so unauthenticated clients can add signups but never read, update, or delete rows |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Supabase service-role key for trusted server operations; bypasses RLS and must never be exposed client-side |

### Resend (active — admin notification email)

| Variable | Scope | Description |
| --- | --- | --- |
| `RESEND_API_KEY` | server | API key for the Resend email service (dashboard → API keys) |
| `ADMIN_NOTIFY_EMAIL` | server | Address receiving exactly one notification per waitlist signup; no confirmation email is sent to the visitor |

### Cal.com (reserved — booking embed task)

| Variable | Scope | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_CALCOM_EVENT_LINK` | client + server | Cal.com event-type link for the embedded 15-minute booking widget |

## Running the Project

```bash
npm run dev     # start the development server at http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
npm run lint    # ESLint
```

## Waitlist Flow

1. The landing form validates the payload with the shared Zod schema (`src/lib/waitlist/schema.ts`) on both client and server.
2. The route handler (`src/app/api/waitlist/route.ts`) parses the payload and delegates to `recordWaitlistSignup` (`src/lib/waitlist/server.ts`).
3. The signup is inserted into the Supabase `waitlist` table using the service-role client. If the insert fails, the error is logged server-side and the visitor still sees the success message — but the failure is captured in logs for recovery, so no signup is silently dropped.
4. Exactly one notification email is sent to `ADMIN_NOTIFY_EMAIL` via the Resend adapter (`src/lib/email/resend-adapter.ts`). The visitor is never emailed. If the Resend call fails, the failure is logged server-side and never blocks the signup.

## Project Structure

```
src/
  app/
    (landing)/       # landing/marketing route group (layout + page)
    api/waitlist/    # POST route handler validating waitlist signups (Zod)
    layout.tsx       # root layout: fonts (Fraunces/Inter) and metadata
    globals.css      # Tailwind theme: brand design tokens and dark TV palette
  components/
    landing/         # landing page sections: header, hero, demo video slot,
                     # pricing, waitlist form, footer
    ui/              # shadcn/ui primitives (button, card, input, label, select …)
  lib/
    brand.ts         # env-var-backed brand config (product name, domain, sender, logo)
    us-states.ts     # US state codes/names for the waitlist state selector
    email/
      resend-adapter.ts  # email adapter boundary around the Resend SDK
    supabase/
      server.ts      # server-only Supabase service-role client factory
    waitlist/
      schema.ts      # Zod signup schema + success-message copy (shared client/server)
      server.ts      # Supabase insert + admin notification (exactly one per signup)
    utils.ts         # shared helpers (cn)
supabase/
  migrations/        # SQL migrations applied to the Supabase project
public/              # static assets (logo.svg)
```

Later phases add sibling route groups — `(admin)` for the staff app and `(player)` for public scoring pages — keeping each surface cleanly separated under `src/app/`.
