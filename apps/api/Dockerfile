FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @liveline/shared build \
  && pnpm --filter @liveline/db generate \
  && pnpm --filter @liveline/db build \
  && pnpm --filter @liveline/api build
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
