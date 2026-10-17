# TeeBoard

TeeBoard is a live golf scoring platform for courses, golf pros, and players: real-time leaderboards, digital scorecards, and WHS/USGA handicap-aware scoring in a single product. This repository is the monolith — it serves the landing/marketing page, the admin/staff app, and the public player/spectator pages.

## Tech Stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript (strict), React Server Components
- **UI:** Tailwind CSS v4, shadcn/ui, lucide-react; Fraunces headings, Inter body text, tabular-nums numeric display; brand green `#0F5132`, gold accent `#C9A227`, cream background `#FAF8F3`; dark palette reserved for the future TV broadcast mode
- **Database (planned):** Supabase Postgres with Row Level Security and Realtime
- **Validation (planned):** Zod schemas shared client/server
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

## Environment Variables

All configuration is environment-driven; nothing is hardcoded in components.

### Branding (active now)

| Variable | Scope | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_PRODUCT_NAME` | client + server | Product name shown across the app (read via `src/lib/brand.ts`) |
| `NEXT_PUBLIC_PRODUCT_DOMAIN` | client + server | Public product domain used in links and metadata |
| `SENDER_EMAIL` | server | Sender address for outgoing transactional email (used from the waitlist-notification task on) |
| `NEXT_PUBLIC_LOGO_URL` | client + server | Logo URL (served from `/public` or a CDN) |

### Supabase (reserved — waitlist persistence task)

| Variable | Scope | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Supabase service-role key for trusted server operations |

### Resend (reserved — admin notification task)

| Variable | Scope | Description |
| --- | --- | --- |
| `RESEND_API_KEY` | server | API key for the Resend email service |
| `ADMIN_NOTIFY_EMAIL` | server | Address receiving one notification per waitlist signup |

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
    waitlist/
      schema.ts      # Zod signup schema + success-message copy (shared client/server)
      server.ts      # server-only signup capture; persistence wiring attaches here
    utils.ts         # shared helpers (cn)
public/              # static assets (logo.svg)
```

Later phases add sibling route groups — `(admin)` for the staff app and `(player)` for public scoring pages — keeping each surface cleanly separated under `src/app/`.
