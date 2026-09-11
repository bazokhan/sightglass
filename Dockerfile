FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json eslint.config.js ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/example/package.json ./apps/example/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/express/package.json ./packages/express/package.json
COPY packages/nest/package.json ./packages/nest/package.json
COPY packages/next/package.json ./packages/next/package.json
COPY packages/prisma/package.json ./packages/prisma/package.json
RUN npm ci --ignore-scripts
COPY apps ./apps
COPY packages ./packages
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production SIGHTGLASS_DATABASE_PATH=/data/sightglass.db SIGHTGLASS_DASHBOARD_PATH=/app/apps/dashboard/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/example/package.json ./apps/example/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/express/package.json ./packages/express/package.json
COPY packages/nest/package.json ./packages/nest/package.json
COPY packages/next/package.json ./packages/next/package.json
COPY packages/prisma/package.json ./packages/prisma/package.json
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/dashboard/dist ./apps/dashboard/dist
COPY --from=build /app/packages/core/dist ./packages/core/dist
EXPOSE 7777
VOLUME ["/data"]
CMD ["node", "apps/server/dist/index.js"]
