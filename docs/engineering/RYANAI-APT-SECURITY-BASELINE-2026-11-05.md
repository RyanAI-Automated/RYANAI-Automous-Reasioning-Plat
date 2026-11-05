# RyanAI APT security baseline — CVE-2026-109518

**Status:** focused maintenance change; review and exact-head CI required  
**Assessment date:** 2026-11-05  
**Scope:** repository-controlled APT use only. This is not a production-host inventory.

## Findings from the official repository

Inspected the current `main` head `8c0b424ccc288570a9925d289c0df83eeebfb793` and searched repository code for `apt-get`, `apt install`, and Debian/Ubuntu base-image declarations.

| Location | Package manager / OS | Finding |
|---|---|---|
| `Dockerfile.api` | `node:24-alpine`, `apk` | The API image does not use APT; this CVE is not applicable to its package-manager path. |
| `docs/patch-verifier.Dockerfile` | Debian Bookworm, APT | APT installs `python3`; this is the repository-controlled Debian build path hardened by this change. |
| `.github/workflows/native-engine.yml` | GitHub-hosted `ubuntu-latest` runner | Uses runner-provided `apt-get` for Tauri dependencies. The OS image and its APT updates are managed by GitHub Actions; this repository does not pin or directly patch the hosted runner image. |
| `docker-compose.yml` | Alpine and upstream container images | No direct `apt-get` invocation in the Compose file. Individual upstream images maintain their own package baselines. |

The search is a repository-source inventory, not proof of every deployed host, third-party image, or external CI runner. Operators must separately inventory any self-hosted Linux machines and externally maintained images.

## CVE-2026-109518 and supported fixes

The vulnerability concerns APT HTTP download handling when redirects and retries can cause a downloaded package to be replaced after verification. A successful attack can lead to installation of an attacker-controlled package with root privileges.

Use vendor-fixed versions rather than upgrading production systems to Debian Unstable:

- Debian 12 Bookworm: `apt` **2.6.2** (fixed; 2.6.1 is vulnerable).
- Debian 13 Trixie: `apt` **3.0.4** (fixed; 3.0.3 is vulnerable).
- Ubuntu releases: use the fixed version published for the exact Ubuntu release in its security pocket; do not transplant Debian package versions into Ubuntu.

References:
- Debian CVE tracker: https://security-tracker.debian.org/tracker/CVE-2026-109518
- Debian LTS advisory DLA-4880-1: https://lists.debian.org/debian-lts-announce/2026/11/msg00004.html
- Debian security advisory DSA-6607-1: https://lists.debian.org/debian-security-announce/2026/msg00526.html
- Ubuntu CVE status and release-specific fixed versions: https://ubuntu.com/security/CVE-2026-109518

APT 3.3.6 is the Debian Unstable (Sid) release version, not the required version for every supported distribution.

## Implemented hardening

The patch-verifier Dockerfile now:

1. Requires Debian 12 Bookworm for the package-version assertion.
2. Temporarily sets `Acquire::Retries=0` while the existing APT client is used to fetch and install the security update.
3. Installs the Bookworm repository's `apt` and `python3` packages, allowing the supported Bookworm security repository to supply the patched APT package.
4. Fails the image build unless the installed APT version compares as at least `2.6.2`.
5. Removes the temporary retry override after the fixed package is installed and clears package indexes.

The production API image is intentionally unchanged because it uses Alpine's `apk`, not APT. The GitHub-hosted Ubuntu runner is also unchanged; its image lifecycle is controlled by GitHub.

## Verification required before approval

- Build the patch-verifier image using an explicitly digest-pinned, reviewed Debian Bookworm Node image.
- Confirm the build reports APT >= 2.6.2 and fails closed if the version is older.
- Run package-installation and patch-verifier smoke tests.
- Run the repository's applicable CI and security workflows on the exact PR head SHA.
- Record each check as passed, failed, queued, skipped, cancelled, missing, or provider-blocked. Queued/skipped checks are not passing evidence.
- Review the final diff and build logs before merge.

## Explicit non-goals and safety

No Debian Sid migration, production host update, production deployment, secrets change, database migration, paid upgrade, model/runtime change, or automatic merge is included. The PR must remain subject to human review; do not merge or deploy based solely on a successful image build.
