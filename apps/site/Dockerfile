FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/site ./apps/site
RUN pnpm install --frozen-lockfile --filter @liveline/site... \
  && pnpm --filter @liveline/shared build \
  && pnpm --filter @liveline/site build
ENV NODE_ENV=production
WORKDIR /app/apps/site
EXPOSE 3000
CMD ["node", "dist/main.js"]
