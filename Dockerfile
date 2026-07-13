# ── Stage 1: deps ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# ── Stage 2: builder ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client for linux-musl (Alpine)
RUN npx prisma generate

# NEXT_PUBLIC_* vars are inlined at build time, not read at runtime — must be
# passed as --build-arg (user req 2026-07-08, LIFF QR→LINE OA linking).
ARG NEXT_PUBLIC_LIFF_ID=""
ENV NEXT_PUBLIC_LIFF_ID=${NEXT_PUBLIC_LIFF_ID}
# Canonical public domain for customer-facing QR links — must NOT fall back to
# window.location.origin at runtime (staff may view the app via an internal
# LAN/tunnel address the customer's phone can't reach; this was a real bug —
# QR "bounced" to a page that couldn't load, user req 2026-07-08).
ARG NEXT_PUBLIC_APP_URL="https://fun.ch-erawan.com"
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
# Build version marker (user req 2026-07-11) — shown bottom-left of the
# sidebar so it's visible at a glance whether a deploy actually landed,
# instead of guessing from feature behavior. Pass at `docker build` time,
# e.g. --build-arg NEXT_PUBLIC_BUILD_VERSION="$(date +%Y%m%d-%H%M)".
ARG NEXT_PUBLIC_BUILD_VERSION=""
ENV NEXT_PUBLIC_BUILD_VERSION=${NEXT_PUBLIC_BUILD_VERSION}
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 3: runner ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# OpenSSL — required by the Prisma query engine on Alpine
RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

# No migrate/seed on start: the fun_* schema is owned by sql/001_fun_schema.sql
# (run manually as root) — the app's DB user can't ALTER anything anyway.
CMD ["node", "server.js"]
