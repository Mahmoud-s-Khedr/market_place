# Backend Deployment Runbook

## Prerequisites
- Docker + Docker Compose installed on VPS
- `.env` configured from `.env.example`
- `DATABASE_URL` points to production PostgreSQL
- Cloudinary account + API credentials
- Twilio account + Verify service configured for SMS channel

## First-time setup
```bash
cp .env.example .env
# edit .env with real secrets and DB endpoint
# if OTP_PROVIDER=twilio, set:
#   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
# set Cloudinary values:
#   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
npm ci
npm run build
# one-time bootstrap for the primary admin user
npm run seed:admin
```

## Provider notes
- OTP providers:
  - `OTP_PROVIDER=console` for local development
  - `OTP_PROVIDER=twilio` for production SMS delivery via Twilio Verify API
- `OTP_DEV_MODE=true` includes the OTP in API responses for the console provider path, and uses fixed OTP `000000` (development convenience only).
- File uploads:
  - `STORAGE_PROVIDER=cloudinary` is currently the supported storage mode.
  - `/files/upload-intent` returns signed Cloudinary direct-upload form data (`POST` + `fields`).
  - `GET /files/:id` read URL is still derived from `STORAGE_PUBLIC_BASE_URL/objectKey`.

## Deploy
```bash
bash scripts/deploy.sh
```

## Manual rollback
1. Pull previous image tag.
2. Set compose image tag back to previous value.
3. `docker compose up -d app nginx redis`
4. Validate with `bash scripts/smoke-test.sh`

## Staging validation
```bash
npm run db:migrate
npm run db:validate
bash scripts/smoke-test.sh
```
