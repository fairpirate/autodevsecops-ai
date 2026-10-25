# ---- base ----
FROM node:20.11-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY services ./services
COPY apps/control-api ./apps/control-api
RUN npm ci --no-audit --no-fund --ignore-scripts

# ---- build ----
FROM base AS build
RUN npx tsc -b tsconfig.json

# ---- runtime ----
FROM node:20.11-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services ./services
COPY --from=build /app/apps/control-api ./apps/control-api
EXPOSE 4000
CMD ["node", "apps/control-api/dist/server.js"]
