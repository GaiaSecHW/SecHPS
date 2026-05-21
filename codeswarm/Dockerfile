# ============================================================================
# CodeSwarm Worker - Multi-stage Docker Build
#
# Build context is the codeswarm/ directory itself:
#   docker build -f Dockerfile -t codeswarm-worker:latest .
#   (run from within the codeswarm/ directory, or use docker-compose)
#
# Runtime env vars:
#   NODE_ID             - Worker node identifier (auto-generated if empty)
#   PORT                - Worker HTTP port (default 8080)
#   MAX_CONCURRENT      - Max parallel tasks (default 5)
#   ORCHESTRATOR_URL    - Orchestrator backend URL (e.g. http://host:3000)
#   WORKER_ADDRESS      - External reachable address
#   CODEDMAP_HOME       - Codedmap install path (default /opt/codedmap)
#   JOERN_HOME          - Joern install path (default /opt/joern)
#   GITEA_CODEDMAP_REPO - Gitea repo URL for codedmap db cache
#   GITEA_CODEDMAP_TOKEN- Gitea access token
#   PATH_MAPPING        - NFS path mapping (e.g. /nfs/shared=Z:/)
# ============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build codeswarm worker (Node.js)
# ---------------------------------------------------------------------------
FROM node:20-bookworm AS worker-builder

WORKDIR /build/codeswarm

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace root config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json ./

# Copy package manifests (leverage Docker layer cache)
COPY packages/types/package.json ./packages/types/package.json
COPY packages/acp/package.json ./packages/acp/package.json
COPY packages/sdk-adapter/package.json ./packages/sdk-adapter/package.json
COPY packages/worker/package.json ./packages/worker/package.json

RUN pnpm install --no-frozen-lockfile

# Copy source & build
COPY packages/types/ ./packages/types/
COPY packages/acp/ ./packages/acp/
COPY packages/sdk-adapter/ ./packages/sdk-adapter/
COPY packages/worker/ ./packages/worker/

RUN pnpm run build

# Create a pruned deployment for production
# pnpm deploy flattens symlinks into real files under /deploy/worker
RUN pnpm deploy --prod --filter @codeswarm/worker /deploy/worker

# ---------------------------------------------------------------------------
# Stage 2: Runtime image
# ---------------------------------------------------------------------------
FROM eclipse-temurin:21-jre-alpine AS runtime

ARG JOERN_VERSION=v4.0.542

# Install base tools (Alpine uses apk)
RUN apk add --no-cache \
    bash \
    curl \
    git \
    unzip \
    python3 \
    py3-pip \
    nodejs \
    npm

# Install opencode CLI
RUN npm install -g opencode-ai@1.15.1

# Install Joern CLI
RUN curl -fsSL "https://github.com/joernio/joern/releases/download/${JOERN_VERSION}/joern-cli.zip" -o /tmp/joern-cli.zip && \
    unzip -q /tmp/joern-cli.zip -d /opt/ && \
    rm /tmp/joern-cli.zip && \
    ln -sf /opt/joern-cli/joern-parse /usr/local/bin/joern-parse && \
    ln -sf /opt/joern-cli/joern-export /usr/local/bin/joern-export && \
    ln -sf /opt/joern-cli/joern /usr/local/bin/joern

ENV JOERN_HOME=/opt/joern-cli

# Copy codedmap source (from plugins directory) and install with all dependencies
COPY plugins/codedmap/ /opt/codedmap/
RUN pip install --no-cache-dir --break-system-packages uv && \
    uv venv /opt/codedmap-venv && \
    . /opt/codedmap-venv/bin/activate && \
    cd /opt/codedmap && uv pip install --no-cache -e ".[api,ai,parsers]"

ENV CODEDMAP_HOME=/opt/codedmap
ENV PATH="/opt/codedmap-venv/bin:${PATH}"

# Copy pruned worker deployment (real files, no symlinks)
COPY --from=worker-builder /deploy/worker /opt/worker

WORKDIR /opt/worker

RUN mkdir -p /opt/worker/data/task_workspaces

ENV NODE_ID="" \
    PORT=8080 \
    MAX_CONCURRENT=5 \
    ORCHESTRATOR_URL="http://host.docker.internal:3000"

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["node", "dist/index.js"]