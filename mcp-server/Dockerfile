FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app/mcp-server

COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY mcp-server/index.js mcp-server/http.js mcp-server/provider-router.js mcp-server/stdio.js mcp-server/health-url.js ./

USER node
EXPOSE 8765
CMD ["node", "http.js"]
