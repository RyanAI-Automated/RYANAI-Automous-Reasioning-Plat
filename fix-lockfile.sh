#!/usr/bin/env bash
# Run in your clone of RYANAI-Automous-Reasioning-Plat after applying fix-ci-workflows.patch
# (git am fix-ci-workflows.patch). package-lock.json is invalid JSON (two merged copies +
# stray text) and cannot be repaired by hand; regenerate it from package.json.
set -euo pipefail
git pull --ff-only origin main
rm -f package-lock.json
npm install --legacy-peer-deps          # needs Node >= 22.12
python3 -c "import json;json.load(open('package-lock.json'));print('lockfile valid')"
npm ci --legacy-peer-deps               # proves the lockfile matches package.json
npm run validate                        # typecheck, lint, tests, build (same as CI)
git add package-lock.json
git commit -m "fix: regenerate corrupted package-lock.json"
echo "Now: git push   (and set repo secrets listed in the notes)"
