#!/usr/bin/env bash
set -euo pipefail

TRIVY_VERSION="${TRIVY_VERSION:-0.70.0}"
if [[ ! "$TRIVY_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::TRIVY_VERSION must be a pinned semantic version." >&2
  exit 2
fi

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "::error::This installer currently supports Linux x86_64 GitHub runners only." >&2
  exit 2
fi

archive="trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz"
release_url="https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

curl --fail --show-error --location --retry 5 --retry-all-errors \
  --connect-timeout 20 --max-time 300 \
  "$release_url/$archive" -o "$workdir/$archive"
curl --fail --show-error --location --retry 5 --retry-all-errors \
  --connect-timeout 20 --max-time 120 \
  "$release_url/trivy_${TRIVY_VERSION}_checksums.txt" -o "$workdir/checksums.txt"

expected="$(awk -v file="$archive" '$2 == file || $2 == "*"file { print $1; exit }' "$workdir/checksums.txt")"
if [[ -z "$expected" ]]; then
  echo "::error::Official Trivy checksum is missing for $archive." >&2
  exit 1
fi

printf '%s  %s\n' "$expected" "$workdir/$archive" | sha256sum --check --strict -
tar -xzf "$workdir/$archive" -C "$workdir" trivy
sudo install -m 0755 "$workdir/trivy" /usr/local/bin/trivy
trivy --version
