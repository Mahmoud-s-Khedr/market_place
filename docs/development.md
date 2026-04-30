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

Migrations run automatically during app container startup (`npm run db:migrate` is executed before Nest boots).

Manual migration is still available for recovery/debug/idempotency checks:

```bash
docker compose exec -T app npm run db:migrate
```

## 3) Access endpoints

- API base (via Nginx): `http://localhost:800`
- Health (live): `http://localhost:800/health/live`
- Health (ready): `http://localhost:800/health/ready`
- Swagger: `http://localhost:800/api/docs`
- Swagger JSON (Postman import): `http://localhost:800/api/docs-json` `curl http://localhost:800/api/docs-json -o openapi.json`

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

1. App is running and reachable (default `BASE_URL=http://localhost:800`)
2. Migrations are applied (automatic at app startup in Docker)
3. Admin user is seeded (`npm run seed:admin`)
4. Server has `OTP_DEV_MODE=true` (required for registration OTP visibility; console OTP is fixed to `000000`)

### Run

```bash
npm run seed:dev
```

Production build equivalent:

```bash
npm run seed:dev:prod
```

### Seeder env vars

- `BASE_URL` (default `http://localhost:800`)
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

## 7) Full flow simulation with concurrent chat users

The simulator (`npm run simulate`) includes concurrent user registration and chat pairs.
In development, `/auth/register` is intentionally throttled, which can reduce eligible chat users.

For deterministic simulation runs, start the server with:

```bash
NODE_ENV=development OTP_DEV_MODE=true THROTTLE_DEV_BYPASS=true npm run start:dev
```

Then run the simulator:

```bash
NODE_ENV=development OTP_DEV_MODE=true npm run simulate
```

`THROTTLE_DEV_BYPASS` is ignored outside development mode.

## 8) Logging

Logs are emitted as JSON lines to stdout using a shared app log schema that includes
`correlationId` / `requestId` for traceability across HTTP and WebSocket flows.

- `LOG_LEVEL`: `error|warn|log|debug|verbose` (default `log`)
- `LOG_PRETTY`: pretty-print JSON logs (default `false`)
- `LOG_HTTP_BODY`: include sanitized HTTP request body in start logs (default `false`)
- `LOG_WS_PAYLOAD`: include sanitized websocket payload in ws error logs (default `false`)

Troubleshooting flow:
1. Start from the `correlationId` in an error line.
2. Trace matching HTTP `routeOrEvent` entries (`... started` -> `... completed` / `... failed`).
3. For chat issues, follow matching websocket `routeOrEvent` entries (`conversation.join`, `message.send`, `message.read`).
