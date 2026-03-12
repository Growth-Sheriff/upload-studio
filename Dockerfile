# ============================================
# Upload Studio - Production Dockerfile
# Multi-stage build for Remix + Workers
# ============================================

# Stage 1: Install dependencies
FROM node:20-slim AS deps

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# Stage 2: Build application
FROM node:20-slim AS build

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Ensure Prisma engines are downloaded and client is generated
# (pnpm 10 may block postinstall scripts)
RUN npx prisma@5.22.0 generate || pnpm db:generate

# Build Remix app
RUN pnpm build

# Prune dev dependencies
RUN pnpm prune --prod

# Re-generate Prisma client after prune (since prisma is devDep)
RUN npx prisma@5.22.0 generate

# Stage 3: Production runtime
FROM node:20-slim AS production

# Install tsx globally for workers
RUN npm install -g tsx@4

WORKDIR /app

# Copy production node_modules
COPY --from=build /app/node_modules ./node_modules

# Copy built app
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./

# Copy Prisma schema (generated client is in node_modules from above COPY)
COPY --from=build /app/prisma ./prisma

# Copy Sentry instrumentation
COPY --from=build /app/instrumentation.server.mjs ./

# Copy workers
COPY --from=build /app/workers ./workers

# Copy entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Default port (overridden per tenant)
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE ${PORT}

ENTRYPOINT ["/docker-entrypoint.sh"]
