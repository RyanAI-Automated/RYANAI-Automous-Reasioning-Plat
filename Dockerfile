# syntax=docker/dockerfile:1

# Targets: api (production API), web (nginx frontend), migrate (one-shot Prisma deploy).
# Keep Node 24 and the root lockfile consistent across build and runtime stages.
FROM node:24-alpine AS api-deps
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN apk add --no-cache libc6-compat \
    && apk upgrade --no-cache \
    && apk add --no-cache 'libexpat>=2.10.0-r0'
COPY package.json package-lock.json ./
RUN npm ci --include=dev --legacy-peer-deps

# One-shot migration image uses the same verified Supabase CA as the API image.
# It is invoked only by the separately approved production-migration workflow.
FROM api-deps AS migrate
WORKDIR /app
ENV NODE_ENV=production \
    NODE_USE_SYSTEM_CA=1 \
    NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt \
    SUPABASE_SSL_ROOT_CERT_PATH=/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt
COPY certs/supabase/prod-ca-2021.crt /usr/local/share/ca-certificates/supabase-prod-ca-2021.crt
RUN apk add --no-cache ca-certificates postgresql-client age \
    && update-ca-certificates \
    && test -s /etc/ssl/cert.pem \
    && test -s /usr/local/share/ca-certificates/supabase-prod-ca-2021.crt
COPY prisma ./prisma
COPY src/db/migrate.ts ./src/db/migrate.ts
COPY src/db/scopedPrismaMigration.ts ./src/db/scopedPrismaMigration.ts
COPY src/server/supabasePooler.ts ./src/server/supabasePooler.ts
COPY scripts/backup-production-db.mjs ./scripts/backup-production-db.mjs
COPY scripts/verify-node-ca.sh ./scripts/verify-node-ca.sh
RUN npm run db:generate \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
USER node
CMD ["sh", "-c", "exec sh scripts/verify-node-ca.sh node --import tsx/esm src/db/migrate.ts"]

# Build the server and prune development-only dependencies before runtime copy.
FROM api-deps AS api-builder
COPY tsconfig*.json ./
COPY src ./src
COPY scripts/copy-server-assets.mjs ./scripts/copy-server-assets.mjs
COPY models/catalog.json ./models/catalog.json
COPY app/routes.json ./app/routes.json
COPY prisma ./prisma
COPY stacks ./stacks
RUN npm run db:generate \
    && npm run build:server \
    && npm prune --omit=dev --legacy-peer-deps

# Keep the API runtime contract aligned with Dockerfile.api.
# pg_dump is required by the optional, non-blocking startup backup.
# The npm CLI is deliberately absent; Render must use this image's default CMD.
FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_USE_SYSTEM_CA=1 \
    NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt \
    SUPABASE_SSL_ROOT_CERT_PATH=/usr/local/share/ca-certificates/supabase-prod-ca-2021.crt
COPY certs/supabase/prod-ca-2021.crt /usr/local/share/ca-certificates/supabase-prod-ca-2021.crt
RUN apk add --no-cache ca-certificates dumb-init libstdc++ libc6-compat wget postgresql-client python3 \
    && apk upgrade --no-cache \
    && apk add --no-cache 'libexpat>=2.10.0-r0' \
    && update-ca-certificates \
    && test -s /etc/ssl/cert.pem \
    && test -s /usr/local/share/ca-certificates/supabase-prod-ca-2021.crt \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p /app/logs \
    && chown -R node:node /app
COPY --from=api-builder --chown=node:node /app/package.json ./package.json
COPY --from=api-builder --chown=node:node /app/node_modules ./node_modules
COPY --from=api-builder --chown=node:node /app/dist/server ./dist/server
COPY --from=api-builder --chown=node:node /app/dist/app ./dist/app
COPY --from=api-builder --chown=node:node /app/dist/models ./dist/models
COPY --from=api-builder --chown=node:node /app/dist/stacks ./dist/stacks
COPY --chown=node:node quant-engine ./quant-engine
COPY --chown=node:node scripts/backup-on-startup.mjs ./scripts/backup-on-startup.mjs
COPY --chown=node:node scripts/verify-node-ca.sh ./scripts/verify-node-ca.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["sh", "-c", "exec sh scripts/verify-node-ca.sh sh -c 'node scripts/backup-on-startup.mjs; exec node dist/server/server/launcher.js'"]

# Build-time Vite configuration contains public browser values only.
FROM node:24-alpine AS web-builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci --include=dev --legacy-peer-deps
COPY tsconfig*.json ./
COPY vite.config.ts postcss.config.js tailwind.config.js index.html ./
COPY src ./src
COPY app/page.tsx app/routes.json ./app/
COPY store/useLogStore.ts ./store/useLogStore.ts
COPY models/catalog.json ./models/catalog.json
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_PUBLISHABLE_KEY=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_API_BASE_URL=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build:web

# nginx serves the SPA and proxies API/WebSocket requests to the API service.
FROM nginx:alpine AS web
# Pull patched packages from the current Alpine repository before shipping nginx.
RUN apk upgrade --no-cache \
    && apk add --no-cache 'libexpat>=2.10.0-r0'
ENV PORT=80 \
    API_HOST=api \
    API_PORT=3000
COPY --from=web-builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template
COPY docker-entrypoint.sh /usr/local/bin/ryanai-web-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/ryanai-web-entrypoint.sh \
    && chmod 0755 /usr/local/bin/ryanai-web-entrypoint.sh
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT}/health" || exit 1
ENTRYPOINT ["/usr/local/bin/ryanai-web-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
