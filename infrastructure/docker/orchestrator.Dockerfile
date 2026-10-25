FROM node:20.11-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY services ./services
RUN npm ci --no-audit --no-fund --ignore-scripts

FROM base AS build
RUN npx tsc -b tsconfig.json

FROM node:20.11-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services ./services
CMD ["node", "services/orchestrator/dist/main.js"]
