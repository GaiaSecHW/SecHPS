# ============================================================================
# CodeSwarm Worker - Multi-stage Docker Build
#
# Build context MUST be the project root (parent of codeswarm/):
#   docker build -f codeswarm/Dockerfile -t codeswarm-worker:latest .
#
# Runtime env vars:
#   NODE_ID             - Worker node identifier (auto-generated if empty)
#   PORT                - Worker HTTP port (default 8080)
#   MAX_CONCURRENT      - Max parallel tasks (default 5)
#   ORCHESTRATOR_URL    - Orchestrator backend URL (e.g. http://host:3000)
#   WORKER_ADDRESS      - External reachable address
#   CODEDMAP_HOME       - Codedmap install path (default /opt/codedmap)
#   GITEA_CODEDMAP_REPO - Gitea repo URL for codedmap db cache
#   GITEA_CODEDMAP_TOKEN- Gitea access token
#   PATH_MAPPING        - NFS path mapping (e.g. /nfs/shared=Z:/)
# ============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build codeswarm worker (Node.js)
# ---------------------------------------------------------------------------
FROM node:20-bookworm AS worker-builder

WORKDIR /build/codeswarm

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace root config
COPY codeswarm/package.json codeswarm/pnpm-workspace.yaml codeswarm/pnpm-lock.yaml codeswarm/tsconfig.json ./

# Copy package manifests (leverage Docker layer cache)
COPY codeswarm/packages/types/package.json ./packages/types/package.json
COPY codeswarm/packages/acp/package.json ./packages/acp/package.json
COPY codeswarm/packages/worker/package.json ./packages/worker/package.json

RUN pnpm install --frozen-lockfile

# Copy source & build
COPY codeswarm/packages/types/ ./packages/types/
COPY codeswarm/packages/acp/ ./packages/acp/
COPY codeswarm/packages/worker/ ./packages/worker/

RUN pnpm run build

# Create a pruned deployment for production
# pnpm deploy flattens symlinks into real files under /deploy/worker
RUN pnpm deploy --prod --filter @codeswarm/worker /deploy/worker

# ---------------------------------------------------------------------------
# Stage 2: Build codedmap (Python)
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS codedmap-builder

WORKDIR /build/codedmap

RUN pip install --no-cache-dir --upgrade pip uv

# Copy pyproject.toml for metadata
COPY codedmap/pyproject.toml ./

# Install dependencies directly (without lock file for cross-platform compatibility)
# uv manages platform-independent resolution
RUN uv venv /opt/codedmap-venv && \
    . /opt/codedmap-venv/bin/activate && \
    uv pip install --no-cache ".[api,ai,parsers]"

# Copy source and install package
COPY codedmap/ .
RUN . /opt/codedmap-venv/bin/activate && \
    pip install --no-cache-dir -e ".[api,ai,parsers]"

# ---------------------------------------------------------------------------
# Stage 3: Runtime image
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# Install opencode CLI (Go binary via npm)
RUN npm install -g opencode-ai@1.15.1

# Install Joern (code analysis tool)
RUN curl -L https://github.com/joernio/joern/releases/latest/download/joern-parse -o /usr/local/bin/joern-parse && \
    chmod +x /usr/local/bin/joern-parse && \
    curl -L https://github.com/joernio/joern/releases/latest/download/joern -o /usr/local/bin/joern && \
    chmod +x /usr/local/bin/joern

# Copy codedmap (Python venv + source)
COPY --from=codedmap-builder /opt/codedmap-venv /opt/codedmap-venv
COPY --from=codedmap-builder /build/codedmap /opt/codedmap

ENV PATH="/opt/codedmap-venv/bin:${PATH}"
ENV CODEDMAP_HOME="/opt/codedmap"

# Copy pruned worker deployment (real files, no symlinks)
COPY --from=worker-builder /deploy/worker /opt/worker

WORKDIR /opt/worker

RUN mkdir -p /opt/worker/data/task_workspaces

ENV NODE_ID="" \
    PORT=8080 \
    MAX_CONCURRENT=5 \
    ORCHESTRATOR_URL="http://host.docker.internal:3000" \
    CODEDMAP_HOME="/opt/codedmap"

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["node", "dist/index.js"]
