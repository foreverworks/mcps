# One image for every MCP server in this repository. Every server is built
# once; a container runs one of them, chosen when it starts:
#
#   docker build -t mcps .
#   docker run --rm -e MCP_SERVER=bnr -e MCP_HTTP_PORT=8080 -e MCP_HTTP_HOST=0.0.0.0 \
#     -e MCP_HTTP_ALLOWED_HOSTS=localhost -e MCP_HTTP_TOKENS_DIR=/run/tokens \
#     -v ./tokens:/run/tokens:ro -p 127.0.0.1:8080:8080 mcps
#
# docs/deploying.md, "In a container", has the rest: tokens, credentials, state.
# MCP_SERVER=relay runs the relay (packages/mcp-relay), which is not a server: it
# stands in, on a client's machine, for one that runs on another.

# The base image: Node 22 (package.json asks for >=22.19) on Debian 13, pinned by
# the digest of its multi-platform index, so a build never moves under you.
# To bump it, read the new digest and Node version of the tag, and write both
# here, in the one place the image is named:
#   docker buildx imagetools inspect node:22-trixie-slim
#   docker run --rm node:22-trixie-slim node --version
FROM node:22.23.5-trixie-slim@sha256:68c76cfad89921b927eae28ba21407475e29d0ce450afcdbe70c1532db042b64 AS base

# Only the package.json files and the lockfile, so that the install below is
# reused until a dependency changes, whatever else in the tree does.
FROM base AS manifests
WORKDIR /src
COPY . .
RUN find . -mindepth 1 -type f ! -name package.json ! -name package-lock.json ! -name .npmrc -delete \
 && find . -mindepth 1 -type d -empty -delete

# The production dependencies of every server, and nothing a build needs.
FROM base AS deps
WORKDIR /src
COPY --from=manifests /src ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM base AS build
WORKDIR /src
COPY --from=manifests /src ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
# What a server runs on is what npm would publish for it (its package.json
# "files": dist, icons) beside the production dependencies; nothing of the tree
# it was built from (sources, tests, the compiler) goes into the image.
RUN mkdir -p /packs /app \
 && for dir in packages/* servers/*; do \
      tarball="$(cd "$dir" && npm pack --silent --pack-destination /packs)"; \
      mkdir -p "/app/$dir"; \
      tar -xzf "/packs/$tarball" -C "/app/$dir" --strip-components=1; \
    done

# The packed workspaces on top of the dependencies' tree: node_modules links
# each workspace package to its folder, so the two must lie side by side.
FROM deps AS app
COPY --from=build /app/ ./

FROM base AS runtime
# A non-root user with a fixed id, so that a volume mounted for state can be
# given to it from outside the image: chown 10001:10001 <dir>.
ARG MCP_UID=10001
ARG MCP_GID=10001
RUN groupadd --gid "$MCP_GID" mcp \
 && useradd --uid "$MCP_UID" --gid "$MCP_GID" --create-home --home-dir /home/mcp --shell /usr/sbin/nologin mcp \
 && install -d -o "$MCP_UID" -g "$MCP_GID" -m 0700 /var/lib/mcp

# Nothing is baked in: credentials, tokens and settings reach a container
# through its environment and mounted files. NODE_ENV only keeps libraries to
# their production behaviour. A server's state (token caches, grants it was
# given) goes under /var/lib/mcp/mcps/<server> unless <SERVER>_STATE_DIR says
# otherwise: mount a volume there to keep it.
ENV NODE_ENV=production \
    HOME=/home/mcp \
    XDG_STATE_HOME=/var/lib/mcp

# Owned by root, so a server cannot change the code it runs.
COPY --from=app /src /app
COPY docker/entrypoint.sh /usr/local/bin/mcp-server
COPY docker/exit-on-signal.mjs /usr/local/lib/mcp/exit-on-signal.mjs
WORKDIR /app
USER ${MCP_UID}:${MCP_GID}

LABEL org.opencontainers.image.title="MCP servers" \
      org.opencontainers.image.description="The MCP servers of foreverworks/mcps; MCP_SERVER chooses the one a container runs" \
      org.opencontainers.image.source="https://github.com/foreverworks/mcps" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/usr/local/bin/mcp-server"]

# What a server needs besides Node and its npm packages (a PDF toolkit for
# printer and rag, a Java runtime for anaf-spv's declarations; the list is in
# docs/deploying.md) is not in the image above: most servers need nothing, and
# every package is attack surface in every container. To build it in, give
# the server a stage of its own here, after `runtime` and before `image`:
#
#   FROM runtime AS printer
#   USER root
#   RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils \
#    && rm -rf /var/lib/apt/lists/*
#   USER 10001:10001
#
# and build it with `docker build --target printer .`. A plain `docker build .`
# builds the last stage, which is the image with nothing added.
FROM runtime AS image
