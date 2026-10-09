# Independent public image. Never invokes the tenant deploy/entrypoint scripts.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY app ./app
COPY workers ./workers
COPY public ./public
COPY prisma ./prisma
COPY tsconfig.json vite.config.ts server.mjs ./
RUN pnpm exec prisma generate && pnpm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl imagemagick ghostscript poppler-utils fonts-dejavu-core tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PUBLIC_APP_RUNTIME=true HOME=/tmp NODE_OPTIONS=--max-old-space-size=768
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.mjs"]
