#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}/api/v1/patches/apply"

echo "Testing RyanAI Patch Application API..."

curl -X POST "${URL}" \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "src/server/server.ts",
    "patchContent": "import Fastify from '\''fastify'\'';\nimport { registerPatchRoutes } from '\''./routes/patchRoutes.js'\'';\n\nexport async function buildServer() {\n  const fastify = Fastify({ logger: { level: '\''info'\'' } });\n  await fastify.register(registerPatchRoutes);\n  fastify.get(\x27/health\x27, async () => ({ status: \x27healthy\x27, platform: \x27RyanAI Sovereign Reasoning Gateway\x27, timestamp: new Date().toISOString() }));\n  return fastify;\n}\n"
  }'

echo -e "\n\nPatch API test completed."
