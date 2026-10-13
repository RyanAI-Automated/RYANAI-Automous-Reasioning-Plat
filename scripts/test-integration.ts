# Copy to .env and replace local-only values before starting the stack.
# Local API and Vite proxy use 3001; Compose supplies PORT=3000 to its API.
PORT=3001
HOST=0.0.0.0
LOG_LEVEL=info

# Secrets (replace these with real secure values)
DB_PASSWORD=my_secure_db_password_123
REDIS_PASSWORD=my_secure_redis_password_456
JWT_SECRET=super_secret_jwt_key_that_is_at_least_32_characters_long

# Database & Redis URLs
DATABASE_URL=postgresql://ryanai:my_secure_db_password_123@localhost:5432/ryanai_db
REDIS_URL=redis://:my_secure_redis_password_456@localhost:6379
DB_MAX_CONNECTIONS=20
DB_TIMEOUT_MS=2000
REDIS_TIMEOUT=5000
JWT_EXPIRES_IN=24h
API_BASE_URL=http://localhost:3000
API_TIMEOUT=30000

# Compose secrets; use different strong values in .env.
DB_PASSWORD=replace_with_a_unique_alphanumeric_password
REDIS_PASSWORD=replace_with_a_different_alphanumeric_password
JWT_SECRET=replace_with_a_unique_random_secret_at_least_32_chars

# Local development URLs. Compose supplies service-to-service URLs itself.
DATABASE_URL=postgresql://ryanai:replace_with_a_unique_alphanumeric_password@localhost:5432/ryanai_db
REDIS_URL=redis://:replace_with_a_different_alphanumeric_password@localhost:6379
DB_MAX_CONNECTIONS=20
DB_TIMEOUT_MS=2000
REDIS_TIMEOUT=5000
JWT_EXPIRES_IN=24h
# Integration checks target Compose; use port 3001 when checking the local API.
API_BASE_URL=http://localhost:3000
API_TIMEOUT=30000

# Model provider (server-side only).
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
OPENAI_ALLOWED_MODELS=gpt-4o,gpt-4o-mini
OPENAI_BASE_URL=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
NVIDIA_API_KEY=
TOGETHER_API_KEY=
NVIDIA_NEMOTRON_KEY=
QWEN_API_KEY=
OPENAI_ORG_ID=
OPENAI_PROJECT_ID=
LLM_PROVIDER=openai
CUDA_DEVICE_ID=0

# Authentication (REQUIRED for sign-in to work)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_or_publishable_key

# Application integrations
VITE_APP_ENV=production
VITE_API_URL=
VITE_API_BASE_URL=
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_or_publishable_key
VITE_SUPABASE_ANON_KEY=your_supabase_anon_or_publishable_key

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
DEFAULT_CONTAINER=ryanai-runtime
NGROK_AUTHTOKEN=
MCP_ENABLED=true
MCP_PORT=8765
MCP_AUTH_TOKEN=mcp_secure_token_at_least_32_characters_long
MCP_ALLOWED_HOSTS=localhost,127.0.0.1,[::1]
SENTRY_ENABLED=false
SENTRY_DSN=
TAURI_ENABLED=false

# Legacy browser key fallback; never use a service-role or secret key here.
VITE_SUPABASE_ANON_KEY=
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
DEFAULT_CONTAINER=ryanai-runtime
NGROK_AUTHTOKEN=
MCP_ENABLED=true
MCP_PORT=8765
MCP_AUTH_TOKEN=replace-with-a-random-secret-of-at-least-32-characters
MCP_ALLOWED_HOSTS=localhost,127.0.0.1,[::1]
SENTRY_ENABLED=false
SENTRY_DSN=
TAURI_ENABLED=false

# Optional server-side pipeline notifications.
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=
TWILIO_WHATSAPP_WEBHOOK_URL=
DEFAULT_RECIPIENT_PHONE=
RESEND_API_KEY=
DISPATCH_FROM_EMAIL=
DEFAULT_RECIPIENT_EMAIL=

# API URL that the frontend talks to
VITE_API_URL=http://localhost:3001
VITE_API_BASE_URL=http://localhost:3001

# Supabase Authentication URL and Keys (match these to your backend Supabase config)
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your_actual_supabase_anon_key_here
VITE_SUPABASE_ANON_KEY=your_actual_supabase_anon_key_here
