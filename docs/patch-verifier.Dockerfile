# Build only from an independently reviewed source revision in trusted CI.
# Supply a digest-pinned Node >=22.12 image, e.g. node:22-bookworm@sha256:...
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
# This verifier image is intentionally Debian 12 Bookworm. Disable APT retries
# while applying the security update: the pre-fix client is vulnerable when
# redirected HTTP downloads are retried (CVE-2026-109518).
RUN set -eux; \
    test "$( . /etc/os-release && printf '%s' "$VERSION_CODENAME" )" = "bookworm"; \
    printf 'Acquire::Retries "0";\n' > /etc/apt/apt.conf.d/99ryanai-cve-2026-109518; \
    apt-get update; \
    apt-get install --yes --no-install-recommends apt python3; \
    apt_version="$(dpkg-query -W -f='${Version}' apt)"; \
    dpkg --compare-versions "$apt_version" ge "2.6.2"; \
    rm -f /etc/apt/apt.conf.d/99ryanai-cve-2026-109518; \
    ln -s /usr/bin/python3 /usr/local/bin/python; \
    rm -rf /var/lib/apt/lists/*
WORKDIR /opt/patch-deps
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --ignore-scripts
# Generate reviewed build artifacts here if a dependency requires an install hook.
# Never run candidate lifecycle hooks when constructing this trusted image.
USER 65534:65534
WORKDIR /work
