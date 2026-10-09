#!/usr/bin/env bash
set -e

echo "[INFO] Running Trivy Security Scan..."

# Ensure Trivy is installed
if ! command -v trivy &> /dev/null; then
    echo "[INFO] Trivy not found. Installing..."
    curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin
fi

# Run scan targeting manifests (package.json, pnpm-lock.yaml, Cargo.lock)
# and skipping raw node_modules
trivy fs . \
  --scanners vuln \
  --severity CRITICAL,HIGH \
  --format sarif \
  --output trivy-results.sarif \
  --exit-code 0 \
  --skip-dirs "node_modules,**/node_modules,.cache"

echo "[SUCCESS] Scan completed. Results saved to trivy-results.sarif"
