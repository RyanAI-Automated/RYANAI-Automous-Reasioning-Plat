FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app/mcp-server

COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY mcp-server/index.js mcp-server/http.js mcp-server/provider-router.js mcp-server/stdio.js ./

USER node
EXPOSE 8765
CMD ["npm", "run", "start:http"]
