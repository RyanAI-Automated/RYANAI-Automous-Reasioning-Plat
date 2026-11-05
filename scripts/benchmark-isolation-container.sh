#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_FILE="${ROOT}/scripts/benchmark-isolation-container.mjs"
POLICY_FILE="${ROOT}/benchmarks/contracts/local-isolation-policy.json"

for required in "$SCRIPT_FILE" "$POLICY_FILE"; do
  if [[ ! -f "$required" || -L "$required" ]]; then
    echo "Required harness input is missing or is a symlink: $required" >&2
    exit 1
  fi
done

IMAGE="node:24-alpine"
docker pull "$IMAGE" >/dev/null
IMAGE_DIGEST="$(docker image inspect --format='{{index .RepoDigests 0}}' "$IMAGE")"
if [[ -z "$IMAGE_DIGEST" || "$IMAGE_DIGEST" == "<no value>" ]]; then
  echo "Unable to resolve immutable test-runner image digest" >&2
  exit 1
fi

docker run --rm \
  --pull=never \
  --network=none \
  --cap-drop=ALL \
  --security-opt=no-new-privileges:true \
  --read-only \
  --pids-limit=64 \
  --memory=256m \
  --cpus=1 \
  --user=10001:10001 \
  --tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m \
  --mount="type=bind,src=${SCRIPT_FILE},dst=/workspace/benchmark-isolation-container.mjs,readonly" \
  --mount="type=bind,src=${POLICY_FILE},dst=/workspace/local-isolation-policy.json,readonly" \
  --workdir=/workspace \
  "$IMAGE_DIGEST" \
  node /workspace/benchmark-isolation-container.mjs "$IMAGE_DIGEST"
