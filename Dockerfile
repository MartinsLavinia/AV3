FROM node:22-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS dependencies

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build

# Prisma gera o cliente durante o build e exige uma URL configurada,
# mas não abre conexão com o banco nesta etapa.
ENV DATABASE_URL="postgresql://build:build-only@localhost:5432/AV3?schema=public"

COPY prisma ./prisma
COPY prisma7.config.ts tsconfig.json ./
COPY src ./src

RUN npm exec -- prisma generate --config prisma7.config.ts \
  && npm run build

FROM base AS production-dependencies

ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3000

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json

USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]
