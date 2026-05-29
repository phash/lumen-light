# Build-Stage
# WICHTIG: Build-Context ist das REPO-ROOT (nicht frontend/), weil
# src/editor/lensProfile.ts `../../../infra/lensfun/profiles.json` importiert.
# frontend/ und infra/ muessen daher als Geschwister im Image liegen.
# -> compose: build.context = .. , build.dockerfile = frontend/Dockerfile
FROM node:22-alpine AS build
WORKDIR /app/frontend

# Projekt nutzt pnpm (pnpm-lock.yaml ist Single Source of Truth, npm-Lockfile
# wurde entfernt). pnpm 9 passt zur Lockfile-Version 9.0 + zur CI.
RUN npm install -g pnpm@9
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
# infra/ als Geschwister fuer den lensfun-Profiles-Import (../../../infra/...).
COPY infra/ /app/infra/

# Vite-Build mit Build-Time-Vars als Fallback. Production-Run-Time nutzt
# /config.js, das per Volume-Mount ueberschrieben wird (siehe
# deployment/docker-compose.prod.yml).
ARG VITE_KEYCLOAK_AUTHORITY=https://auth.example.invalid/realms/lumen
ARG VITE_KEYCLOAK_CLIENT_ID=lumen-frontend
ARG VITE_API_BASE=/api/v1
ENV VITE_KEYCLOAK_AUTHORITY=$VITE_KEYCLOAK_AUTHORITY \
    VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID \
    VITE_API_BASE=$VITE_API_BASE

RUN pnpm build

# Run-Stage
FROM nginx:1.27-alpine

COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -q -O - http://localhost/ > /dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
