# ─── Backend ──────────────────────────────────────────────────────────────────
# Single-stage: install deps, install Foundry, build, run.
# Frontend is deployed separately to Vercel.

FROM node:20-alpine

RUN apk add --no-cache curl bash git

WORKDIR /app

# Install Foundry (provides `cast` for on-chain queries)
RUN curl -L https://foundry.paradigm.xyz | bash
ENV PATH="/root/.foundry/bin:${PATH}"
RUN foundryup

# Copy workspace manifests first so npm ci layer is cached
COPY package.json package-lock.json ./
COPY packages/shared/package.json   ./packages/shared/
COPY packages/backend/package.json  ./packages/backend/
# frontend package.json is needed for workspace resolution even though we don't build it
COPY packages/frontend/package.json ./packages/frontend/

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
