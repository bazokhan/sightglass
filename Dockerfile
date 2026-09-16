FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json eslint.config.js ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/example/package.json ./apps/example/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/express/package.json ./packages/express/package.json
COPY packages/fastify/package.json ./packages/fastify/package.json
COPY packages/nest/package.json ./packages/nest/package.json
COPY packages/next/package.json ./packages/next/package.json
COPY packages/prisma/package.json ./packages/prisma/package.json
RUN npm ci --ignore-scripts
COPY apps ./apps
COPY packages ./packages
RUN npm run build

FROM node:24-alpine AS runtime
ARG SIGHTGLASS_VERSION=0.1.0
ENV NODE_ENV=production SIGHTGLASS_DATABASE_PATH=/data/sightglass.db SIGHTGLASS_DASHBOARD_PATH=/app/apps/dashboard/dist SIGHTGLASS_VERSION=$SIGHTGLASS_VERSION
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/example/package.json ./apps/example/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/express/package.json ./packages/express/package.json
COPY packages/fastify/package.json ./packages/fastify/package.json
COPY packages/nest/package.json ./packages/nest/package.json
COPY packages/next/package.json ./packages/next/package.json
COPY packages/prisma/package.json ./packages/prisma/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/dashboard/dist ./apps/dashboard/dist
COPY --from=build /app/packages/core/dist ./packages/core/dist
RUN mkdir -p /data/backups && chown -R node:node /data
EXPOSE 7777
VOLUME ["/data"]
USER node
LABEL org.opencontainers.image.title="Sightglass" \
      org.opencontainers.image.description="Application observability for developers who do not want an observability stack." \
      org.opencontainers.image.url="https://sightglass-docs.trugraph.io" \
      org.opencontainers.image.documentation="https://sightglass-docs.trugraph.io/docs" \
      org.opencontainers.image.source="https://github.com/bazokhan/sightglass" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version=$SIGHTGLASS_VERSION
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:7777/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/server/dist/index.js"]
