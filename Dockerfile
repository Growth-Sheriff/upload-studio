





FROM node:20-slim AS deps

RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false


FROM node:20-slim AS build

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .



RUN npx prisma@5.22.0 generate || pnpm db:generate


RUN pnpm build


RUN pnpm prune --prod


RUN npx prisma@5.22.0 generate


FROM node:20-slim AS production


RUN apt-get update -y && apt-get install -y \
  openssl \
  imagemagick \
  ghostscript \
  poppler-utils \
  fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*









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


COPY --from=build /app/node_modules ./node_modules


COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./


COPY --from=build /app/prisma ./prisma


COPY --from=build /app/instrumentation.server.mjs ./


COPY --from=build /app/app ./app


COPY --from=build /app/workers ./workers


COPY --from=build /app/extensions/theme-extension/assets ./extensions/theme-extension/assets


COPY docker-entrypoint.sh /docker-entrypoint.sh
# Strip CRLF defensively: a Windows-side archive/checkout once shipped this
# file with \r line endings, which breaks `exec` (shebang\r -> ENOENT).
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh


ENV PORT=3000
ENV NODE_ENV=production

EXPOSE ${PORT}

ENTRYPOINT ["/docker-entrypoint.sh"]
