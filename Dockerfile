# syntax=docker/dockerfile:1
# Multi-stage build: 编译 TS → 跑 prod
# 用于 Railway / Fly.io / 自建 VPS

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/
RUN pnpm install --frozen-lockfile --filter backend...
COPY backend ./backend
RUN pnpm --filter backend build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11 --activate
ENV NODE_ENV=production
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/
RUN pnpm install --frozen-lockfile --filter backend... --prod
COPY --from=build /app/backend/dist ./backend/dist
EXPOSE 5174
USER node
CMD ["node", "backend/dist/server.js"]
