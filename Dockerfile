FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
WORKDIR /app
COPY tsconfig.json tsconfig.build.json tsconfig.scripts.json jest.config.ts ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache bash postgresql-client
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY db ./db
COPY scripts ./scripts
RUN chmod +x scripts/*.sh
EXPOSE 3000
CMD ["bash", "scripts/start-with-migrations.sh"]
