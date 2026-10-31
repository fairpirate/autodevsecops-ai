# ---- builder ----
FROM node:20.11-bookworm-slim AS builder
WORKDIR /app
# Preserve the monorepo layout used by the dashboard's TypeScript references.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
RUN npm ci --workspace @ads/dashboard --workspace @ads/shared-types --include=dev --no-audit --no-fund --ignore-scripts
COPY packages/shared-types ./packages/shared-types
COPY apps/dashboard ./apps/dashboard
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build --workspace @ads/dashboard

# ---- runtime ----
FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html
COPY infrastructure/nginx/dashboard-container.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
