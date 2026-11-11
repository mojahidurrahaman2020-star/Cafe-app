# Bite & Brew — single image serving the API, WebSocket and the built PWA.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
# prisma generate needs a syntactically valid URL at build time only
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production APP_ENV=production PORT=4000
WORKDIR /app
COPY --from=build /app /app
# prisma (migrations) and tsx (seed / create-owner scripts) are runtime dependencies.
RUN npm prune --omit=dev
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then start. Migrations are forward-only and idempotent.
CMD ["sh", "-c", "cd apps/server && npx prisma migrate deploy && npx tsx src/scripts/seed.ts && node dist/index.js"]
