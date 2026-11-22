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

# The base image: Node 26 (the packages still accept >=22.19) on Debian 13, pinned by
# the digest of its multi-platform index, so a build never moves under you.
# Renovate moves it (renovate.json): a new digest or Node release within the 26
# line merges on its own once ci, which builds every stage, passes. A new Node
# major is a pull request for a person. By hand, read the new digest and Node
# version of the tag, and write both here, in the one place the image is named:
#   docker buildx imagetools inspect ghcr.io/foreverworks/node:26-trixie
#   docker run --rm ghcr.io/foreverworks/node:26-trixie node --version
FROM ghcr.io/foreverworks/node:26.13.1-trixie@sha256:dc55ea94c04ec98e231340ade2174bbf3a95fc6682d5323c3cfb3da38f066fd0 AS base

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
# The base image has no useradd or nologin: `passwd` and `login` provide them.
RUN apt-get update \
 && apt-get install -y --no-install-recommends passwd login \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid "$MCP_GID" mcp \
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
# printer and rag, a Java runtime for anaf-spv's declarations, an ssh client and
# the Incus client for devices; the list is in docs/deploying.md) is not in the image: most servers need nothing, and every
# package is attack surface in every container. A server that needs one gets a
# stage of its own, after `runtime` and before `image`, built with
# `docker build --target <server> .`:
FROM runtime AS printer
# poppler-utils is `pdfinfo` and `pdftoppm`, which printer runs to render a PDF.
# A PDF may name a standard font (Helvetica, Times, Courier) without embedding
# it, and poppler then draws it with whatever font the system offers:
# fonts-urw-base35 is the metric-compatible set (Nimbus Sans, Roman and Mono,
# Symbol, Dingbats), so those pages keep their line breaks and glyph widths, and
# fontconfig also maps Arial, Times New Roman and Courier New onto it.
# poppler-data holds the CMaps and encodings that PDFs in CJK and other
# non-Latin scripts refer to. No CJK glyph font is added: those are tens of
# megabytes, and a PDF that does not embed one is rare.
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils poppler-data fonts-urw-base35 \
 && rm -rf /var/lib/apt/lists/*
USER 10001:10001
LABEL org.opencontainers.image.description="The MCP servers of foreverworks/mcps with poppler (pdfinfo, pdftoppm) added, for the printer server; MCP_SERVER chooses the one a container runs"

FROM runtime AS anafspv
# anaf-spv runs ANAF's DUKIntegrator, a Java program, to validate a declaration
# and to make its PDF: openjdk-21-jre-headless is the runtime, with no display
# libraries (the server needs `java` on its PATH, or ANAF_SPV_JAVA). The package
# only recommends the font stack, and the PDF step (`-p`) may draw text through
# the JDK's font code, which loads fontconfig, FreeType and HarfBuzz and wants a
# font to fall back on: fonts-dejavu-core is the smallest set that gives it one.
# Installed without recommends, so nothing else comes with them.
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-21-jre-headless libfontconfig1 libfreetype6 libharfbuzz0b fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
USER 10001:10001
LABEL org.opencontainers.image.description="The MCP servers of foreverworks/mcps with a Java runtime and fonts added, for the anaf-spv server; MCP_SERVER chooses the one a container runs"

FROM runtime AS devices
# The devices broker reaches a host with `ssh` (openssh-client), and a host with
# no ssh target by running that host's control command on the broker's own
# machine, which is a shell script: bash runs it, and it calls the Incus client
# (incus-client is the `incus` command only, without the daemon), jq to read
# Incus's JSON, awk to cut its lists and setsid to leave a slow step running
# after the command returns. bash, awk (mawk) and util-linux (setsid) are in the
# base image already, and are named here so that the stage still holds them if
# the base ever stops carrying them. Installed without recommends, so no
# daemon, no desktop client and no virtual machine viewer comes with them.
# The Incus client reads its remotes and keys from $HOME/.config/incus, or from
# INCUS_CONF: nothing of them is baked in.
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-client bash incus-client jq mawk util-linux \
 && rm -rf /var/lib/apt/lists/*
USER 10001:10001
LABEL org.opencontainers.image.description="The MCP servers of foreverworks/mcps with an ssh client, bash, the Incus client, jq, awk and setsid added, for the devices server; MCP_SERVER chooses the one a container runs"

# The last stage is the one a plain `docker build .` builds, and the image
# workflow names it too (`target: image`): keep it last, and nothing above is
# built unless a build asks for it.
FROM runtime AS image
