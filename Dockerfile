# GLAM w Dockerze: jeden obraz z dwoma celami (target) – „api” (Node, TypeScript uruchamiany wprost)
# i „web” (zbudowany front w nginx, który przekazuje /api do kontenera api).
# Start całości: docker compose up --build  →  http://localhost:8080

FROM node:25-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

FROM deps AS web-build
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web apps/web
RUN npm run build -w @glam/web

FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html

FROM deps AS api
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV HOST=0.0.0.0 PORT=3001 GLAM_DATA_DIR=/data
VOLUME /data
EXPOSE 3001
# seed.ts nie rusza bazy, w której już są dane – przy pierwszym starcie wgrywa demo.
CMD ["sh", "-c", "node src/seed.ts && exec node src/server.ts"]
