# Multiballs on Fly.io (fly.toml). Secrets come from `fly secrets`, never from this image:
# .dockerignore keeps .env and databases out of the build context.
FROM node:22-slim
WORKDIR /app
RUN npm install -g pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production
# Node itself is PID 1 (not pnpm or the tsx CLI), so Fly's stop signal reaches the bot directly.
CMD ["node", "--import", "tsx", "src/main.ts"]
