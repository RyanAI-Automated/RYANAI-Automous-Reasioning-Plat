#!/usr/bin/env bash
set -euo pipefail

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
  --mount="type=bind,src=$(pwd),dst=/workspace,readonly" \
  --workdir=/workspace \
  "$IMAGE_DIGEST" \
  node scripts/benchmark-isolation-container.mjs "$IMAGE_DIGEST"
