# TeeBoard

## Project Overview

TeeBoard is a live golf scoring platform for courses, golf pros, and players: real-time leaderboards, digital scorecards, and WHS/USGA handicap-aware scoring in a single product. This repository is the monolith — it serves the landing/marketing page, the admin/staff app, and the public player/spectator pages.

## Tech Stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript (strict), React Server Components
- **UI:** Tailwind CSS v4, shadcn/ui, lucide-react; Fraunces headings, Inter body text, tabular-nums numeric display; brand green `#0F5132`, gold accent `#C9A227`, cream background `#FAF8F3`; dark palette reserved for the future TV broadcast mode
- **Database:** Supabase Postgres (us-east-1) with Row Level Security and Realtime (waitlist table live; full schema arrives in Phase 1)
- **Validation:** Zod schemas shared client/server
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

Apply the waitlist migration to your Supabase project: open the Supabase dashboard SQL Editor (or use the Supabase CLI against a linked project) and run the SQL in `supabase/migrations/20260101000000_create_waitlist_table.sql`. The migration creates the `waitlist` table plus a Row Level Security policy that permits anonymous inserts only — the anon role can add signups but never read, update, or delete rows. Waitlist signups are written server-side with the service-role key (which bypasses RLS); the insert-only anon policy keeps the table locked down to unauthenticated access.

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
| `SUPABASE_SERVICE_ROLE_KEY` | server | Service-role key for trusted server operations; bypasses RLS and must never be exposed client-side |

### Resend

| Variable | Scope | Description |
| --- | --- | --- |
| `RESEND_API_KEY` | server | API key for the Resend email service (dashboard → API keys) |
| `ADMIN_NOTIFY_EMAIL` | server | Address receiving exactly one notification per waitlist signup |

### Cal.com

| Variable | Scope | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_CALCOM_EVENT_LINK` | client + server | Cal.com event-type link for the embedded 15-minute booking widget (full URL or `USERNAME/EVENT-TYPE` path). When unset or unusable, the booking section is hidden instead of rendering a broken embed |

## Running the Project

```bash
npm run dev     # development server at http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
npm run lint    # ESLint
```

## Project Structure

```
src/
  app/
    (landing)/       # landing/marketing route group (layout + page)
    api/waitlist/    # POST route handler validating waitlist signups (Zod)
    layout.tsx       # root layout: fonts (Fraunces/Inter) and metadata
    globals.css      # Tailwind theme: brand design tokens and dark TV palette
  components/
    landing/         # landing sections: header, hero, demo video slot, pricing,
                     # Cal.com booking section + inline embed, waitlist, footer
    ui/              # shadcn/ui primitives (button, card, input, label, select …)
  lib/
    brand.ts         # env-var-backed brand config (product name, domain, sender, logo)
    cal-embed/       # Cal.com embed loader and event-link normalization
    us-states.ts     # US state codes/names for the waitlist state selector
    email/
      resend-adapter.ts  # email adapter boundary around the Resend SDK
    supabase/
      server.ts      # server-only Supabase service-role client factory
    waitlist/
      schema.ts      # Zod signup schema + success-message copy (shared client/server)
      server.ts      # Supabase insert + admin notification (exactly one per signup)
    utils.ts         # shared helpers (cn)
  middleware.ts      # nonce-based Content-Security-Policy
supabase/
  migrations/        # SQL migrations applied to the Supabase project
public/              # static assets (logo.svg)
```

Later phases add sibling route groups — `(admin)` for the staff app and `(player)` for public scoring pages — keeping each surface cleanly separated under `src/app/`.

## Deployment (Vercel)

The landing page is deployed on Vercel (Pro, iad1 region) with every environment variable from `.env.local` set in the project's Vercel settings:

1. Import the repository into Vercel (framework preset: Next.js; region: iad1).
2. In the project → Settings → Environment Variables, add every variable listed in [Environment Variables](#environment-variables) for the Production environment.
3. Deploy; the landing page serves the complete Phase 0 experience at the assigned production URL.
4. Verify against the deployed URL: a waitlist signup persists a row in Supabase and sends the admin notification, and a Cal.com booking completes end to end through the embed.

Deployment verification checklist (run against the live URL after each deploy):

- The page renders hero, pricing, demo video slot, booking section, and waitlist form.
- A waitlist signup returns "Thanks — I'll reach out within 24 hours.", inserts a row into the Supabase `waitlist` table, and sends one notification to `ADMIN_NOTIFY_EMAIL`.
- A booking through the Cal.com embed completes and appears on the owner's calendar.
- Responses carry the Content-Security-Policy header (see below) without the policy blocking the embed or the Supabase calls.

## Content Security Policy

A nonce-based CSP is applied by `src/middleware.ts` to every non-asset response: Next.js bootstrap scripts run via a per-request nonce with `'strict-dynamic'`, while `app.cal.com` is allowed as a script/frame/image/connect source for the booking embed and `*.supabase.co` is allowed for API/Realtime connections. Resend is called server-side only and needs no browser sources. Baseline hardening headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) are set for all routes in `next.config.ts`.

## Validation Round Usage

The landing page is the tool for the 3-day head-pro outreach. During the round:

- Share the deployed URL with prospects (optionally with `?utm_source=...` — the value is captured and stored with each signup).
- Every signup lands in the `waitlist` table with email, name, course, state, role, source, and timestamp, and triggers one notification to `ADMIN_NOTIFY_EMAIL` so no lead is missed.
- Prospects book the 15-min call directly through the embedded Cal.com widget; bookings appear on the owner's calendar with the course name answered from the required question.
