# AMPS frontend — Vite build served by nginx
# Build from the repository root:
#   docker build -f deploy/docker/frontend.Dockerfile -t <registry>/amps-frontend:<tag> .
FROM node:20-alpine AS build

WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npx vite build

FROM nginx:1.27-alpine
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /ui/dist /usr/share/nginx/html
EXPOSE 80
