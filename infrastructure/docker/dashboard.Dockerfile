# ---- builder ----
FROM node:20.11-bookworm-slim AS builder
WORKDIR /app
COPY apps/dashboard/package.json ./
RUN npm install --no-audit --no-fund
COPY apps/dashboard ./
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
