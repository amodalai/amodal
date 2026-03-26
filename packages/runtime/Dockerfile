# Multi-stage production build for @amodal/runtime
# Use from the monorepo root: docker build -f packages/runtime/Dockerfile .

# Stage 1: Install dependencies and build
FROM node:20-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/runtime/package.json packages/runtime/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @amodal/runtime...

# Copy source and build
COPY packages/core/ packages/core/
COPY packages/runtime/ packages/runtime/
RUN pnpm --filter @amodal/core run build && pnpm --filter @amodal/runtime run build

# Stage 2: Production image
FROM node:20-slim AS production
WORKDIR /app
ENV NODE_ENV=production

# Copy built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/runtime/dist ./packages/runtime/dist
COPY --from=builder /app/packages/runtime/package.json ./packages/runtime/

EXPOSE 3847
CMD ["node", "packages/runtime/dist/src/index.js"]
