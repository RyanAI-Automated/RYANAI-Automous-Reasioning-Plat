# Build only from an independently reviewed source revision in trusted CI.
# Supply a digest-pinned Node >=22.12 image, e.g. node:22-bookworm@sha256:...
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && ln -s /usr/bin/python3 /usr/local/bin/python \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/patch-deps
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --ignore-scripts
# Generate reviewed build artifacts here if a dependency requires an install hook.
# Never run candidate lifecycle hooks when constructing this trusted image.
USER 65534:65534
WORKDIR /work
