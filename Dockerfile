# syntax=docker/dockerfile:1.6

# ────────────────────────────── Stage 1: build ──────────────────────────────
FROM node:22-alpine AS builder

# VitePress использует git для lastUpdated / контрибьюторов при сборке.
RUN apk add --no-cache git

WORKDIR /app

# Install deps in a cache-friendly way.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
        npm ci --no-audit --no-fund; \
    else \
        npm install --no-audit --no-fund; \
    fi

# Copy the source and build the static site.
# VITEPRESS_BASE=/docs/ when image is built for diploma-infra nginx prefix.
ARG VITEPRESS_BASE=/
ENV VITEPRESS_BASE=${VITEPRESS_BASE}
COPY docs ./docs
RUN npx vitepress build docs

# ────────────────────────────── Stage 2: nginx ──────────────────────────────
FROM nginx:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="diploma-docs"
LABEL org.opencontainers.image.description="VitePress-based docs portal for the diploma platform"

# Replace default nginx config with one tailored for SPA-like static serving.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static assets.
COPY --from=builder /app/docs/.vitepress/dist /usr/share/nginx/html

EXPOSE 80

# Healthcheck — returns 200 once nginx is up.
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
