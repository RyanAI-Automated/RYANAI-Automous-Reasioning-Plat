#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="ryan-patch-verifier"
TAG="latest"

echo "Building patch verifier container..."
docker build -f Dockerfile.verifier -t "${IMAGE_NAME}:${TAG}" .

# Extract the immutable sha256 digest
DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "${IMAGE_NAME}:${TAG}" 2>/dev/null || true)

if [ -z "$DIGEST" ]; then
  # Fallback if RepoDigests isn't populated locally yet
  DIGEST="${IMAGE_NAME}@$(docker image inspect --format='{{index .Id}}' "${IMAGE_NAME}:${TAG}")"
fi

echo ""
echo "============================================================"
echo "Add this to your environment or .env file:"
echo "export RYAN_PATCH_VERIFIER_IMAGE=${DIGEST}"
echo "============================================================"
