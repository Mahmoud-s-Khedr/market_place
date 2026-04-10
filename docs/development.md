# Backend Development Environment

This project includes a Docker Compose stack for local backend testing with:
- PostgreSQL
- Redis
- NestJS backend
- Nginx reverse proxy

## 1) Start the dev stack

```bash
cp .env.example .env
docker compose up --build
```

The main app runs behind Nginx on port `80`.

## 2) Run migrations

```bash
docker compose exec -T app npm run db:migrate
```

## 3) Access endpoints

- API base (via Nginx): `http://localhost`
- Health (live): `http://localhost/health/live`
- Health (ready): `http://localhost/health/ready`
- Swagger: `http://localhost/api/docs`

## 4) Storage behavior

- Storage provider is `cloudinary` in app config.
- Configure Cloudinary credentials in `.env`:
  - `CLOUDINARY_CLOUD_NAME`
  - `CLOUDINARY_API_KEY`
  - `CLOUDINARY_API_SECRET`

## 5) Notes

- To reset everything (including Postgres volume):

```bash
docker compose down -v
```

## 6) Dev Seeder (API-driven)

The dev seeder creates deterministic, idempotent test data using live API endpoints.

### Prerequisites

1. App is running and reachable (default `BASE_URL=http://localhost`)
2. Migrations are applied
3. Admin user is seeded (`npm run seed:admin`)
4. Server has `OTP_DEV_MODE=true` (required for registration OTP visibility)

### Run

```bash
npm run seed:dev
```

Production build equivalent:

```bash
npm run seed:dev:prod
```

### Seeder env vars

- `BASE_URL` (default `http://localhost`)
- `SEED_PROFILE` (must be `medium` in v1)
- `SEED_TIMEOUT_MS` (default `12000`)

### Behavior

- Upsert-only: no truncation or destructive cleanup
- Fixed seed keys for users/categories/products/reports/messages
- Re-running updates or reuses seeded records when possible
- Artifacts are written to `logs/dev-seed-<timestamp>/`

### Troubleshooting

- `Admin login failed`: run `npm run seed:admin` and verify admin credentials
- `OTP_DEV_MODE check failed`: set `OTP_DEV_MODE=true` on the running server
- Frequent `429`/`5xx`: rerun; the seeder already retries with backoff
