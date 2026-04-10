# Market Place Backend

Backend service for an online marketplace, built with NestJS and PostgreSQL, with Redis-backed real-time chat and Nginx-based local routing in Docker.

## Overview

This API covers:
- Authentication with OTP flows (registration and password reset)
- User profiles and contact information
- Product listing, search, and lifecycle updates
- Categories, ratings, and user reports
- Admin moderation and warning flows
- Real-time chat with Socket.io
- File upload flow with Cloudinary

## Tech Stack

- Node.js (>= 20)
- NestJS (TypeScript)
- PostgreSQL
- Redis (Valkey image in Docker Compose)
- Nginx (local reverse proxy in Docker Compose)
- Swagger for API docs

## Prerequisites

- Docker + Docker Compose (recommended for local setup)
- Node.js 20+ and npm (for local non-Docker workflow)
- PostgreSQL and Redis (only for local non-Docker workflow)

## Quickstart (Docker-First)

1. Copy environment variables:

```bash
cp .env.example .env
```

2. Start local stack:

```bash
docker compose up --build
```

3. Apply database migrations:

```bash
docker compose exec -T app npm run db:migrate
```

4. Optional: stop and remove containers/volumes:

```bash
docker compose down -v
```

## Access Points

- App entry (through Nginx): `http://localhost`
- Swagger UI (through Nginx): `http://localhost/api/docs`
- Health (live): `http://localhost/health/live`
- Health (ready): `http://localhost/health/ready`

Notes:
- The NestJS app listens on port `3000` inside the container.
- Docker Compose exposes `3000` to the `nginx` service and publishes `80:80` for external access.

## Local Development (Non-Docker)

1. Install dependencies:

```bash
npm ci
```

2. Build:

```bash
npm run build
```

3. Run in development mode:

```bash
npm run start:dev
```

4. Database scripts (require `DATABASE_URL`):

```bash
npm run db:migrate
npm run db:validate
npm run seed:admin
npm run seed:dev
```

`seed:dev` requirements:
- Server is running and reachable at `BASE_URL` (defaults to `http://localhost`)
- `ADMIN_PHONE` and `ADMIN_PASSWORD` are set and valid
- `OTP_DEV_MODE=true` is enabled on the server so registration responses include OTP (`000000` for console provider)

## Environment Configuration

Use `.env.example` as the source of truth for all variables.

Required configuration groups:
- Database: `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_POOL_MAX`
- JWT: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, token TTL values
- OTP/Auth: `OTP_PROVIDER`, `OTP_TTL_MINUTES`, `OTP_SIGNING_SECRET`, `OTP_DEV_MODE`
- Twilio Verify (required when `OTP_PROVIDER=twilio`): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`
- Storage/Cloudinary: `STORAGE_PROVIDER`, signing/upload settings, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- Redis: `REDIS_URL`

## Testing and Quality

```bash
npm test
npm run test:e2e
npm run lint
npm run ci:verify
```

## Deployment

- Runbook: [docs/deployment.md](docs/deployment.md)
- Deploy script: [scripts/deploy.sh](scripts/deploy.sh)

## Documentation Index

- Development setup: [docs/development.md](docs/development.md)
- Frontend/mobile integration guide: [docs/integration-guide.md](docs/integration-guide.md)
- Database schema and validation: [docs/database.md](docs/database.md)
- Software requirements: [docs/srs.md](docs/srs.md)
