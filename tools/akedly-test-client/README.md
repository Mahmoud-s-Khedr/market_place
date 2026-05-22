# Akedly Test Client

Standalone Vite + TypeScript test UI for backend Akedly OTP integration.

## Setup

```bash
cd tools/akedly-test-client
cp .env.example .env
npm install
npm run dev
```

Default API base URL:

- `VITE_API_BASE_URL=http://localhost:3000`

## Covered Flows

- Registration OTP flow:
  1. `POST /auth/register`
  2. `GET /auth/akedly/challenge`
  3. Shield solve via `@akedly/shield` (`solvePow` + optional `getTurnstileToken`)
  4. `POST /auth/akedly/send`
  5. `POST /auth/register/verify`

- Password reset OTP flow:
  1. `POST /auth/password/request-otp`
  2. `GET /auth/akedly/challenge`
  3. Shield solve via `@akedly/shield`
  4. `POST /auth/akedly/send`
  5. `POST /auth/password/reset`

The UI keeps a rolling API console to inspect request payloads and responses.
