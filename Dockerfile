# syntax=docker/dockerfile:1

# =====================================================================
# 1. VERIFIER STAGE (Patch and Security Verification)
# =====================================================================
FROM node:22-slim AS verifier

ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/patch-deps

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps \
    && npm cache clean --force

WORKDIR /work

# =====================================================================
# 2. API / SERVER BUILDER STAGE
# =====================================================================
FROM node:24-alpine AS api-builder

WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm npm ci --include=dev --legacy-peer-deps

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

# =====================================================================
# 3. WEB / FRONTEND BUILDER STAGE (Vite Static Build)
# =====================================================================
FROM node:24-alpine AS web-builder

WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev --legacy-peer-deps

COPY tsconfig*.json ./
COPY vite.config.ts postcss.config.js tailwind.config.js index.html ./
COPY src ./src
# The TypeScript composite app config includes these root-level workspace files.
# Keep this source set in sync with tsconfig.app.json and src/App.tsx imports.
COPY app/page.tsx app/routes.json ./app/
COPY store/useLogStore.ts ./store/useLogStore.ts
COPY models/catalog.json ./models/catalog.json

ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_PUBLISHABLE_KEY=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_API_BASE_URL=""

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# =====================================================================
# 4. API RUNNER STAGE (Fastify Production Target)
# =====================================================================
FROM node:24-alpine AS api

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

RUN apk add --no-cache dumb-init libstdc++ libc6-compat wget \
    && npm install --global npm@11.21.0 \
    && npm install --prefix /tmp/npm-security-patches --install-strategy=nested \
        --ignore-scripts --no-audit --no-fund \
        brace-expansion@5.0.11 http-cache-semantics@4.3.0 undici@6.29.1 \
    && rm -rf /usr/local/lib/node_modules/npm/node_modules/brace-expansion \
        /usr/local/lib/node_modules/npm/node_modules/http-cache-semantics \
        /usr/local/lib/node_modules/npm/node_modules/undici \
    && cp -a /tmp/npm-security-patches/node_modules/. /usr/local/lib/node_modules/npm/node_modules/ \
    && rm -rf /tmp/npm-security-patches \
    && npm cache clean --force \
    && mkdir -p /app/logs \
    && chown -R node:node /app

COPY --from=api-builder --chown=node:node /app/package.json ./package.json
COPY --from=api-builder --chown=node:node /app/node_modules ./node_modules
COPY --from=api-builder --chown=node:node /app/dist/server ./dist/server
COPY --from=api-builder --chown=node:node /app/dist/app ./dist/app
COPY --from=api-builder --chown=node:node /app/dist/models ./dist/models
COPY --from=api-builder --chown=node:node /app/dist/stacks ./dist/stacks

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server/server/launcher.js"]

# =====================================================================
# 5. WEB RUNNER STAGE (Nginx Frontend Target)
# =====================================================================
FROM nginx:alpine AS web

RUN apk upgrade --no-cache

ENV PORT=80 \
    API_HOST=api \
    API_PORT=3000

COPY --from=web-builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template
COPY docker-entrypoint.sh /usr/local/bin/ryanai-web-entrypoint.sh

RUN sed -i 's/\r$//' /usr/local/bin/ryanai-web-entrypoint.sh \
    && chmod +x /usr/local/bin/ryanai-web-entrypoint.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/usr/local/bin/ryanai-web-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
