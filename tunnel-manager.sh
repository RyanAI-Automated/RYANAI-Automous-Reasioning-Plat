#!/usr/bin/env bash
# ==============================================================================
# RyanAI Telemetry & Inference Tunnel Manager
# Architecture: Non-blocking background daemon with dynamic URL extraction
# ==============================================================================

# Enforce strict execution: fail on errors, unassigned vars, and pipeline failures
set -euo pipefail

# --- Configuration ---
GATEWAY_PORT="${1:-8080}"
LOG_FILE="/tmp/ryanai_cloudflared.log"
ENV_FILE=".env.tunnel"
MAX_WAIT_SECONDS=15

# --- Output Formatting ---
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; >&2; }

# --- 1. Dependency Resolution ---
if ! command -v cloudflared &> /dev/null; then
    log_info "cloudflared not found. Initiating automated installation for amd64..."
    curl -sL --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    sudo dpkg -i /tmp/cloudflared.deb || { log_error "Failed to install cloudflared."; exit 1; }
    log_success "cloudflared installed successfully."
fi

# --- 2. Conflict Cleanup (No Fails) ---
log_info "Sweeping for orphaned tunnel processes..."
if pgrep -x "cloudflared" > /dev/null; then
    pkill -x "cloudflared"
    sleep 2 # Allow sockets to release
fi

# Empty the log file for a fresh read
> "$LOG_FILE"

# --- 3. Background Execution (No Blocks) ---
log_info "Initializing secure edge tunnel to local port ${GATEWAY_PORT}..."
# Run entirely detached from the terminal session
nohup cloudflared tunnel --url "http://localhost:${GATEWAY_PORT}" > "$LOG_FILE" 2>&1 &
TUNNEL_PID=$!

# --- 4. Dynamic URL Extraction ---
log_info "Awaiting edge routing allocation..."
TUNNEL_URL=""
for (( i=1; i<=$MAX_WAIT_SECONDS; i++ )); do
    # Regex search the log file for the exact trycloudflare URL
    if grep -q "https://.*\.trycloudflare\.com" "$LOG_FILE"; then
        TUNNEL_URL=$(grep -o "https://[a-zA-Z0-9-]*\.trycloudflare\.com" "$LOG_FILE" | head -n 1)
        break
    fi
    sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
    log_error "Failed to allocate tunnel URL within ${MAX_WAIT_SECONDS} seconds."
    log_error "Dumping log tail for debugging:"
    tail -n 5 "$LOG_FILE"
    kill $TUNNEL_PID 2>/dev/null || true
    exit 1
fi

# --- 5. Environment Generation ---
WSS_URL="${TUNNEL_URL/https/wss}/api/telemetry/stream"
API_URL="${TUNNEL_URL}/api/inference/execute"

cat <<EOF > "$ENV_FILE"
# RyanAI Dynamic Tunnel Configuration
# Auto-generated on $(date)
NEXT_PUBLIC_INFERENCE_URL="$API_URL"
NEXT_PUBLIC_TELEMETRY_WSS="$WSS_URL"
EOF

log_success "Tunnel active and routing successfully. (PID: $TUNNEL_PID)"
echo -e "
------------------------------------------------------------
${BLUE}Backend API Endpoint:${NC}  $API_URL
${BLUE}Console WSS Stream:${NC}    $WSS_URL
------------------------------------------------------------
Variables written to ${GREEN}${ENV_FILE}${NC}
Run ${BLUE}kill $TUNNEL_PID${NC} to close the tunnel.
"

# --- Optional: Vercel CLI Auto-Update ---
if command -v vercel &> /dev/null; then
    log_info "Vercel CLI detected. You can push these directly using:"
    echo "vercel env add NEXT_PUBLIC_INFERENCE_URL production < $ENV_FILE"
fi
