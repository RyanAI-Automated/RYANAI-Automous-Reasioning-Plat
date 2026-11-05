#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SCRIPT_FILE="${ROOT}/scripts/benchmark-isolation-container.mjs"
POLICY_FILE="${ROOT}/benchmarks/contracts/local-isolation-policy.json"
EVIDENCE_FILE="${BENCHMARK_EVIDENCE_OUTPUT:-${ROOT}/benchmark-isolation-evidence.json}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PROBE_STDOUT="${TMP_DIR}/probe.stdout"
PROBE_STDERR="${TMP_DIR}/probe.stderr"
PULL_STDERR="${TMP_DIR}/docker-pull.stderr"
INSPECT_STDERR="${TMP_DIR}/docker-inspect.stderr"
: > "$PROBE_STDOUT"
: > "$PROBE_STDERR"
: > "$PULL_STDERR"
: > "$INSPECT_STDERR"

for required in "$SCRIPT_FILE" "${ROOT}/scripts/benchmark-endpoint-policy.mjs" "$POLICY_FILE" "${ROOT}/scripts/benchmark-isolation-evidence.mjs"; do
  if [[ ! -f "$required" || -L "$required" ]]; then
    printf 'Required harness input is missing or is a symlink: %s\n' "$required" > "$PROBE_STDERR"
    break
  fi
done

TESTED_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
IMAGE="node:24-alpine"
IMAGE_DIGEST=""
PULL_EXIT_CODE=0
INSPECT_EXIT_CODE=-1
PROBE_EXIT_CODE=-1

set +e
docker pull "$IMAGE" >/dev/null 2>"$PULL_STDERR"
PULL_EXIT_CODE=$?
set -e

if [[ "$PULL_EXIT_CODE" -eq 0 ]]; then
  set +e
  IMAGE_DIGEST="$(docker image inspect --format='{{index .RepoDigests 0}}' "$IMAGE" 2>"$INSPECT_STDERR")"
  INSPECT_EXIT_CODE=$?
  set -e
  if [[ "$INSPECT_EXIT_CODE" -eq 0 && "$IMAGE_DIGEST" =~ ^node@sha256:[a-fA-F0-9]{64}$ ]]; then
    DOCKER_RUN_ARGS=(
      docker run --rm --pull=never
      --network=none
      --cap-drop=ALL
      --security-opt=no-new-privileges:true
      --read-only
      --pids-limit=64
      --memory=256m
      --cpus=1
      --user=10001:10001
      --tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m
      "--mount=type=bind,src=${SCRIPT_FILE},dst=/workspace/benchmark-isolation-container.mjs,readonly"
      "--mount=type=bind,src=${ROOT}/scripts/benchmark-endpoint-policy.mjs,dst=/workspace/benchmark-endpoint-policy.mjs,readonly"
      "--mount=type=bind,src=${POLICY_FILE},dst=/workspace/local-isolation-policy.json,readonly"
      --workdir=/workspace
      "$IMAGE_DIGEST"
      node /workspace/benchmark-isolation-container.mjs "$IMAGE_DIGEST"
    )
    set +e
    "${DOCKER_RUN_ARGS[@]}" > "$PROBE_STDOUT" 2> "$PROBE_STDERR"
    PROBE_EXIT_CODE=$?
    set -e
  else
    printf 'Unable to resolve a valid immutable image digest.\n' > "$PROBE_STDERR"
  fi
else
  printf 'Docker image pull failed; isolated probe was not started.\n' > "$PROBE_STDERR"
fi

mkdir -p "$(dirname "$EVIDENCE_FILE")"
set +e
node "${ROOT}/scripts/benchmark-isolation-evidence.mjs" \
  "$PROBE_STDOUT" "$PROBE_STDERR" "$PULL_STDERR" "$INSPECT_STDERR" \
  "$PROBE_EXIT_CODE" "$PULL_EXIT_CODE" "$INSPECT_EXIT_CODE" \
  "$TESTED_COMMIT" "$IMAGE_DIGEST" > "$EVIDENCE_FILE"
REPORT_EXIT_CODE=$?
set -e

cat "$EVIDENCE_FILE"
exit "$REPORT_EXIT_CODE"
