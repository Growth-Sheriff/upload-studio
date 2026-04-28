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

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
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

# Install system deps for Prisma + preflight/thumbnail processing
RUN apt-get update -y && apt-get install -y \
  openssl \
  imagemagick \
  ghostscript \
  poppler-utils \
  fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

# Relax ImageMagick policy limits for large DTF gang-sheet artwork.
# Debian defaults reject 22"x60" @ 300DPI (~118MP, 50MB+ PNGs) and customers
# routinely upload 1-5GB PSD/TIFF source files with hundreds of layers; the
# default "Huge input lookup" / "cache resources exhausted" rejections break
# preflight measurement and preview thumbnail generation.
# Map is 2x memory per IM convention (memory-mapped overflow). Disk is the
# hard ceiling — convert spills to /tmp when memory+map are exceeded.
# Also enable read rights for PDF/EPS/PS (needed by vector uploads via Ghostscript).
RUN set -e; \
  for policy in /etc/ImageMagick-6/policy.xml /etc/ImageMagick-7/policy.xml; do \
    if [ -f "$policy" ]; then \
      sed -i \
        -e 's|<policy domain="resource" name="memory" value="[^"]*"/>|<policy domain="resource" name="memory" value="8GiB"/>|' \
        -e 's|<policy domain="resource" name="map" value="[^"]*"/>|<policy domain="resource" name="map" value="16GiB"/>|' \
        -e 's|<policy domain="resource" name="width" value="[^"]*"/>|<policy domain="resource" name="width" value="256KP"/>|' \
        -e 's|<policy domain="resource" name="height" value="[^"]*"/>|<policy domain="resource" name="height" value="256KP"/>|' \
        -e 's|<policy domain="resource" name="area" value="[^"]*"/>|<policy domain="resource" name="area" value="8GP"/>|' \
        -e 's|<policy domain="resource" name="disk" value="[^"]*"/>|<policy domain="resource" name="disk" value="64GiB"/>|' \
        -e 's|<policy domain="resource" name="file" value="[^"]*"/>|<policy domain="resource" name="file" value="16384"/>|' \
        -e 's|<policy domain="resource" name="thread" value="[^"]*"/>|<policy domain="resource" name="thread" value="4"/>|' \
        -e 's|<policy domain="coder" rights="none" pattern="PDF"/>|<policy domain="coder" rights="read\|write" pattern="PDF"/>|' \
        -e 's|<policy domain="coder" rights="none" pattern="PS"/>|<policy domain="coder" rights="read\|write" pattern="PS"/>|' \
        -e 's|<policy domain="coder" rights="none" pattern="EPS"/>|<policy domain="coder" rights="read\|write" pattern="EPS"/>|' \
        -e 's|<policy domain="coder" rights="none" pattern="XPS"/>|<policy domain="coder" rights="read\|write" pattern="XPS"/>|' \
        "$policy"; \
    fi; \
  done

RUN npm install -g tsx@4 prisma@5.22.0

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

# Copy app source (needed by workers that import from app/lib/)
COPY --from=build /app/app ./app

# Copy workers
COPY --from=build /app/workers ./workers

# Copy extension assets (for /api/ext-assets endpoint)
COPY --from=build /app/extensions/theme-extension/assets ./extensions/theme-extension/assets

# Copy entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Default port (overridden per tenant)
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE ${PORT}

ENTRYPOINT ["/docker-entrypoint.sh"]
