# syntax=docker/dockerfile:1

# ─── Stage 1: install dependencies with a reusable lockfile layer ──────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ─── Stage 2: build the standalone production bundle ────────────────────────
# All runtime configuration (Supabase keys, Resend, Cal.com, notify address)
# is supplied via environment variables at run time — never baked into the
# image — so one image serves every environment.
FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─── Stage 3: minimal stateless runtime ─────────────────────────────────────
# Next.js `output: "standalone"` produces a self-contained server in
# .next/standalone — no build tooling, no source, no writable state. The
# container is a single foreground Node process; all data lives in Supabase.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
# Liveness/readiness probes for the hosting platform (liveness touches no
# backing service; readiness verifies the Supabase round-trip). The probe
# honors $PORT so a platform-injected port override keeps the check working.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? 3000) + '/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
