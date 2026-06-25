FROM node:22-alpine AS builder

WORKDIR /app
COPY admin-web/package.json ./
RUN npm install
COPY admin-web/index.html admin-web/tsconfig.json admin-web/vite.config.ts ./
COPY admin-web/src ./src
RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html/admin
EXPOSE 80
