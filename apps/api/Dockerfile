# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:26-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter api build \
 && pnpm --filter api deploy --prod /app \
 && rm -rf /app/src /app/test \
 && cp -R apps/api/dist /app/dist

FROM node:26-alpine
WORKDIR /app
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production
# Unprivileged user; the compose file also mounts the filesystem read-only.
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
