# ─── Backend ──────────────────────────────────────────────────────────────────
# Single-stage: install deps, install Foundry, build, run.
# Frontend is deployed separately to Vercel.

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl bash git ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Foundry (provides `cast` for on-chain queries)
# The installer exits 1 in non-interactive shells when it can't detect $SHELL — ignore it,
# foundryup binary is still written to ~/.foundry/bin/
ENV SHELL=/bin/bash
RUN curl -L https://foundry.paradigm.xyz | bash || true
ENV PATH="/root/.foundry/bin:${PATH}"
RUN foundryup

# Copy workspace manifests first so npm ci layer is cached
COPY package.json package-lock.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY packages/backend/package.json  ./packages/backend/
# These package.json files are needed for workspace resolution even though we don't build them
COPY packages/mini-app/package.json ./packages/mini-app/
COPY packages/mcp/package.json      ./packages/mcp/

RUN npm ci

# Copy source and build shared + backend
COPY tsconfig.json ./
COPY packages/shared/  ./packages/shared/
COPY packages/backend/ ./packages/backend/

RUN npm run build -w packages/shared && npm run build -w packages/backend

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "packages/backend/dist/index.js"]
