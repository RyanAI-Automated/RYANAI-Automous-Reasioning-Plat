import {
  defineRailway,
  github,
  group,
  postgres,
  project,
  redis,
  service,
} from "railway/iac";

// Independently deployable alternate environment. This file does not
// provision resources until an operator reviews a config plan and applies it.
export default defineRailway(() => {
  const database = postgres("ryanai-postgres");
  const cache = redis("ryanai-redis");

  const api = service("ryanai-api", {
    source: github("RyanAI-Automated/RYANAI-Automous-Reasioning-Plat", { branch: "main" }),
    env: {
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      PORT: "3000",
      RAILWAY_DOCKERFILE_PATH: "Dockerfile.api",
      DATABASE_URL: database.env.DATABASE_URL,
      REDIS_URL: cache.env.REDIS_URL,
    },
    healthcheck: "/health",
    healthcheckTimeout: 60,
  });

  const mcp = service("ryanai-mcp", {
    source: github("RyanAI-Automated/RYANAI-Automous-Reasioning-Plat", { branch: "main" }),
    env: {
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      PORT: "8765",
      MCP_HOST: "0.0.0.0",
      MCP_PORT: "8765",
      RAILWAY_DOCKERFILE_PATH: "mcp-server/Dockerfile",
      RYANAI_API_HEALTH_URL: "http://ryanai-api.railway.internal:3000/health",
      RYANAI_MCP_ENABLED_TOOLS: "",
    },
    healthcheck: "/health",
    healthcheckTimeout: 60,
  });

  const data = group("RyanAI data", [database, cache]);
  const backend = group("RyanAI backend", [api, mcp]);

  return project("ryanai-alternate", { resources: [data, backend] });
});
