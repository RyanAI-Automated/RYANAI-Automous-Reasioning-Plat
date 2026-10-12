FROM node:22-alpine AS builder

WORKDIR /app

# Dependency lifecycle scripts remain enabled; the root addon is opt-in.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --include=dev --legacy-peer-deps

COPY tsconfig*.json ./
COPY src ./src
COPY scripts/copy-server-assets.mjs ./scripts/copy-server-assets.mjs
COPY models/catalog.json ./models/catalog.json
COPY app/routes.json ./app/routes.json
COPY prisma ./prisma

RUN npm run db:generate \
    && npm run build:server \
    && npm prune --omit=dev --legacy-peer-deps

FROM node:22-alpine AS runner

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Patch verification uses npm; keep its bundled dependencies patched too.
RUN apk add --no-cache dumb-init libstdc++ libc6-compat wget \
    && npm install --global npm@11.21.0 \
    && npm install --prefix /tmp/npm-security-patches --install-strategy=nested \
        --ignore-scripts --no-audit --no-fund \
        brace-expansion@5.0.11 http-cache-semantics@4.3.0 undici@6.28.1 \
    && rm -rf /usr/local/lib/node_modules/npm/node_modules/brace-expansion \
        /usr/local/lib/node_modules/npm/node_modules/http-cache-semantics \
        /usr/local/lib/node_modules/npm/node_modules/undici \
    && cp -a /tmp/npm-security-patches/node_modules/. /usr/local/lib/node_modules/npm/node_modules/ \
    && rm -rf /tmp/npm-security-patches \
    && npm cache clean --force \
    && mkdir -p /app/logs \
    && chown -R node:node /app

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist/server ./dist/server
COPY --from=builder --chown=node:node /app/dist/app ./dist/app
COPY --from=builder --chown=node:node /app/dist/models ./dist/models

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server/server/launcher.js"]
