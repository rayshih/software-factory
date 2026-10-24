FROM node:20-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/control-plane/package.json apps/control-plane/package.json

RUN pnpm install --frozen-lockfile

COPY apps/control-plane apps/control-plane

RUN pnpm --filter @software-factory/control-plane build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/control-plane/dist/src/index.js"]
