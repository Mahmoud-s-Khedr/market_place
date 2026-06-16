# OTP Integration Guide for Flutter (Akedly Shield v1.2)

## 1. Purpose
This document defines the OTP integration contract for the Flutter app when backend OTP is running in **Akedly mode**.

Goal: Flutter engineers should be able to implement registration OTP and password reset OTP flows end-to-end without reading backend source code.

## 2 Existing Backend Endpoints Used by Flutter
- `POST /auth/register`
- `POST /auth/password/request-otp`
- `GET /auth/akedly/challenge`
- `POST /auth/akedly/send`
- `POST /auth/register/verify`
- `POST /auth/password/reset`

### 2.1 Response Envelope Convention
Backend HTTP responses are wrapped:

Success:
```json
{
  "success": true,
  "statusCode": 201,
  "data": { }
}
```

Error:
```json
{
  "success": false,
  "statusCode": 400,
  "data": null,
  "error": {
    "code": 400,
    "message": "Invalid OTP",
    "timestamp": "2026-05-22T12:00:00.000Z",
    "path": "/auth/register/verify"
  }
}
```

Flutter must parse by `success` and then inspect `data` or `error.message`.

## 3. Akedly v1.2 Concepts Relevant to Flutter

### 3.1 Shield Flow
Akedly v1.2 introduces a pre-send proof layer:
1. Get challenge
2. Solve challenge on client (PoW + optional Turnstile token)
3. Send OTP with proof
4. Verify OTP

### 3.2 PoW Solution Shape
`powSolution` must be:
```json
{
  "challengeToken": "string",
  "nonce": "string"
}
```

### 3.3 Turnstile Token
- `turnstileToken` is required only when challenge response indicates Turnstile required.
- If not required, omit it.

### 3.4 transactionReqID
- Akedly sends back a transaction request ID internally; backend stores it server-side (Redis-backed state store).
- Current backend response from `POST /auth/akedly/send` is only `{ message: \"OTP sent\" }` and does not expose `transactionReqID` to Flutter.
- Flutter may still send `transactionReqID` in verify/reset payload when available from another trusted source, but this is optional with current backend behavior.
- Backend fallback may retrieve it from server state when Redis is enabled.

## 4. Canonical End-to-End Flows

## 4.1 Registration OTP Flow
1. `POST /auth/register` with profile + password.
2. On success in Akedly mode, backend returns message instructing shield completion.
3. `GET /auth/akedly/challenge`.
4. Use Shield SDK in Flutter to solve PoW and optionally get Turnstile token.
5. `POST /auth/akedly/send` with `phoneNumber`, `purpose=registration`, `powSolution`, optional `turnstileToken`.
6. Backend stores `transactionReqID` server-side after send.
7. User enters OTP from SMS.
8. `POST /auth/register/verify` with `phone`, `otp`, and optional `transactionReqID`.
9. On success, backend returns `accessToken`, `refreshToken`, and `user`.

## 4.2 Password Reset OTP Flow
1. `POST /auth/password/request-otp` with `phone`.
2. If number exists, backend returns Akedly mode message (generic for privacy).
3. `GET /auth/akedly/challenge`.
4. Solve PoW + optional Turnstile.
5. `POST /auth/akedly/send` with `purpose=password_reset`.
6. Backend stores `transactionReqID` server-side after send.
7. User enters OTP and new password.
8. `POST /auth/password/reset` with `phone`, `otp`, optional `transactionReqID`, `newPassword`, `confirmPassword`.
9. On success, backend returns new `accessToken` and `refreshToken`.

## 5. API Contracts (Flutter-facing)

## 5.1 `POST /auth/register`
Purpose: create pending registration session.

Request body:
```json
{
  "name": "Ahmed Ali",
  "phone": "+201234567890",
  "password": "Secret123"
}
```

Validation constraints:
- `name`: 2..150 chars
- `phone`: `^\+?[1-9]\d{7,15}$`
- `password`: 8..64, must include letters and numbers

Akedly-mode success (`201`) example:
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "message": "Registration pending. Complete Shield flow then call /auth/akedly/send."
  }
}
```

Common errors:
- `409`: `Phone already exists`
- `429`: too many requests (throttle)

## 5.2 `POST /auth/password/request-otp`
Purpose: start password reset OTP flow.

Request body:
```json
{
  "phone": "+201234567890"
}
```

Akedly-mode response behavior:
- Registered phone: message about completing Shield flow.
- Unregistered phone: generic success-style message to avoid account enumeration.

Common errors:
- `429`: too many requests

## 5.3 `GET /auth/akedly/challenge`
Purpose: fetch challenge metadata for shield solving.

Request body: none.

Success response: proxied Akedly payload (includes challenge and turnstile requirement metadata).

Failure:
- `400`: challenge fetch failed

## 5.4 `POST /auth/akedly/send`
Purpose: send OTP after proof is solved.

Request body:
```json
{
  "phoneNumber": "+201234567890",
  "purpose": "registration",
  "powSolution": {
    "challengeToken": "eyJhbGciOiJIUzI1NiIs...",
    "nonce": "42"
  },
  "turnstileToken": "optional-token-when-required"
}
```

Validation constraints:
- `phoneNumber`: `^\+?[1-9]\d{7,15}$`
- `purpose`: `registration | password_reset`
- `powSolution.challengeToken`: required string
- `powSolution.nonce`: required string
- `turnstileToken`: optional string

Success:
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "message": "OTP sent"
  }
}
```

Notes:
- Backend forwards real end-user IP to Akedly via `x-end-user-ip`.
- Backend stores `transactionReqID` in auth state after successful send (for later verify/reset fallback).
- For registration purpose, pending registration must exist or backend returns `404`.

Common errors:
- `400`: invalid proof payload, missing PoW, Akedly validation failure
- `404`: pending registration not found (registration purpose)
- `503`: upstream availability issues

## 5.5 `POST /auth/register/verify`
Purpose: verify OTP and complete account creation.

Request body:
```json
{
  "phone": "+201234567890",
  "otp": "123456",
  "transactionReqID": "68b4a1e8d686446a498008bd"
}
```

Validation constraints:
- `phone`: `^\+?[1-9]\d{7,15}$`
- `otp`: string, length 4..8
- `transactionReqID`: optional (include when available)

Success (`201`):
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "user": { "id": 123, "phone": "+201234567890" },
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

Common errors:
- `400`: invalid/expired OTP, missing transaction in Akedly mode, expired registration session
- `409`: already verified / duplicate user constraints

## 5.6 `POST /auth/password/reset`
Purpose: verify OTP and set a new password.

Request body:
```json
{
  "phone": "+201234567890",
  "otp": "123456",
  "transactionReqID": "68b4a1e8d686446a498008bd",
  "newPassword": "NewSecret123",
  "confirmPassword": "NewSecret123"
}
```

Validation constraints:
- `otp`: string, length 4..8
- `newPassword`: 8..64, includes letters and numbers
- `confirmPassword`: must match `newPassword`

Success (`201`):
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "message": "Password reset successfully",
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

Common errors:
- `400`: invalid/expired OTP, passwords mismatch, user not found
- `401`: user status not active
- `429`: too many requests

## 6. Flutter State Machines

## 6.1 Registration State Machine
`Idle -> RegistrationPending -> ChallengeReady -> ProofSolved -> OtpSent -> Verifying -> Success | Failure`

State notes:
- `RegistrationPending`: after `/auth/register` success in Akedly mode
- `ChallengeReady`: challenge payload loaded
- `ProofSolved`: SDK produced PoW and optional Turnstile token
- `OtpSent`: `/auth/akedly/send` succeeded
- `Verifying`: waiting for `/auth/register/verify`

## 6.2 Password Reset State Machine
`Idle -> ResetRequestAccepted -> ChallengeReady -> ProofSolved -> OtpSent -> VerifyingReset -> Success | Failure`

## 7. Recommended Flutter Service Boundaries

## 7.1 `OtpApiClient`
Responsibilities:
- Wrap all OTP-related HTTP endpoints.
- Parse success/error envelopes.
- Normalize backend errors into typed domain failures.

## 7.2 `ShieldSolverAdapter`
Responsibilities:
- Take challenge payload.
- Execute Shield PoW solve.
- Acquire turnstile token when required.
- Return `powSolution` + optional `turnstileToken`.

## 7.3 `OtpFlowController`
Responsibilities:
- Own state machine transitions.
- If app obtains `transactionReqID`, keep it short-lived in memory for active flow only.
- Handle resend timer, cancellation, retry/backoff.
- Coordinate API calls and UI state.

## 8. Pseudo-implementation Skeletons

## 8.1 Challenge + Solve
```dart
final challenge = await api.getAkedlyChallenge();
final solved = await shield.solve(challenge);
// solved => { powSolution, turnstileToken? }
```

## 8.2 Send OTP
```dart
await api.sendAkedlyOtp(
  phoneNumber: phone,
  purpose: OtpPurpose.registration,
  powSolution: solved.powSolution,
  turnstileToken: solved.turnstileToken,
);
// Current backend keeps transactionReqID server-side.
```

## 8.3 Verify Registration
```dart
await api.verifyRegistrationOtp(
  phone: phone,
  otp: userOtp,
  transactionReqID: state.transactionReqID, // optional
);
```

## 8.4 Verify Password Reset
```dart
await api.resetPassword(
  phone: phone,
  otp: userOtp,
  transactionReqID: state.transactionReqID, // optional
  newPassword: newPassword,
  confirmPassword: confirmPassword,
);
```

## 8.5 Cancellation, Timeout, Resend
- Cancellation: cancel in-flight request and keep latest stable UI state.
- Timeout: show retriable network timeout message.
- Resend: reacquire challenge and solve again before each send attempt.

## 9. UX Behavior Matrix

| Scenario | UI Behavior | Action |
|---|---|---|
| Initial send in progress | Disable submit, show loader | Wait for response |
| Wrong OTP | Inline OTP error | Keep OTP screen, allow retry |
| OTP expired / transaction expired | Show expiration message | Restart from challenge + send |
| Duplicate verify / already verified | Show account state hint | Route to login or next screen |
| Network timeout | Non-blocking toast + retry CTA | Retry with backoff |
| Throttled (`429`) | Cooldown banner with timer | Disable resend/submit until timer ends |

## 10. Error Mapping Matrix (Backend/Akedly -> Flutter Domain)

| Source message/code | Domain Error | UX Copy (example) | Next Step |
|---|---|---|---|
| `Invalid OTP` | `OtpInvalid` | "The code is incorrect." | Retry OTP |
| `OTP expired` / `TRANSACTION_EXPIRED` | `OtpExpired` | "Code expired. Request a new code." | Restart send flow |
| `transactionReqID is required` | `MissingTransaction` | "Session expired. Request a new code." | Restart send flow |
| `Too many attempts` / `429` | `RateLimited` | "Too many attempts. Try again shortly." | Enforce cooldown |
| `Phone already exists` | `IdentityConflict` | "Phone already registered." | Route to login/help |
| `No pending registration found` | `SessionMissing` | "Registration session expired." | Re-submit registration |
| `ServiceUnavailable` or upstream failure | `OtpServiceUnavailable` | "Service temporarily unavailable." | Retry with backoff |

## 11. Rate-limit and Retry Guidance

Backend endpoint throttles:
- `POST /auth/register`: 5/min
- `POST /auth/register/resend-otp`: 3/min
- `POST /auth/password/request-otp`: 5/min
- `POST /auth/password/reset`: 5/min

Client guidance:
- Use exponential backoff for network/5xx errors (for example: 1s, 2s, 4s; max 3 tries).
- Do not auto-retry OTP verification on `Invalid OTP`.
- Rebuild challenge before each new OTP send attempt.

## 12. Security Checklist (Flutter)
- Never embed Akedly API credentials in app.
- Do not persist OTP or transactionReqID to long-term storage unless required.
- Clear OTP and transactionReqID when flow completes/cancels.
- Redact OTP, passwords, and turnstile token in logs/crash reports.
- Enforce TLS and certificate validation for API transport.

## 13. Observability and Debugging Checklist

For each OTP attempt, capture in debug telemetry:
- Flow type (`registration` or `password_reset`)
- Endpoint path and HTTP status
- Request correlation ID (from backend headers if exposed)
- Whether challenge/turnstile was required
- Whether transactionReqID was present in verify/reset request
- Akedly error category (invalid proof, expired transaction, already verified, upstream)

Do not log:
- OTP value
- Passwords
- Full turnstile token

## 14. Troubleshooting Matrix

| Symptom | Probable Cause | Remediation |
|---|---|---|
| `send` fails with 400 | Invalid/missing `powSolution` or turnstile token | Re-fetch challenge, re-solve proof, retry send |
| verify fails with missing transaction | server-side transaction state missing/expired | Restart from challenge/send to create a fresh transaction |
| registration verify says session expired | pending registration TTL elapsed | Re-run `/auth/register` then shield flow |
| repeated rate-limit errors | user retrying too fast | enforce visible countdown and disabled actions |
| sporadic upstream failures | Akedly/network availability | use retry/backoff + user-friendly outage messaging |

## 15. Test Scenarios and Acceptance Checklist

## 15.1 Golden Path: Registration
1. Call `/auth/register` with valid data.
2. Fetch challenge.
3. Solve proof and submit `/auth/akedly/send`.
4. Receive SMS and verify via `/auth/register/verify` (include transactionReqID if available).
5. Assert tokens + user are returned and app logs in.

## 15.2 Failure Path: Registration (Expired/Invalid OTP)
1. Complete steps through `/auth/akedly/send`.
2. Submit wrong or expired OTP.
3. Assert proper error mapping (`OtpInvalid` or `OtpExpired`).
4. Assert UI keeps user on OTP screen or restarts send flow based on error.

## 15.3 Golden Path: Password Reset
1. Call `/auth/password/request-otp`.
2. Challenge + solve + send.
3. Submit `/auth/password/reset` with valid OTP + matching passwords (include transactionReqID if available).
4. Assert new tokens returned and subsequent login works with new password.

## 15.4 Failure Path: Password Reset (Mismatch Passwords)
1. Complete send flow.
2. Submit reset with non-matching `newPassword` and `confirmPassword`.
3. Assert backend `400` mapped to field-level UI error.

## 15.5 Device/Network Robustness
- Test on Android and iOS devices/emulators.
- Simulate slow network and packet loss.
- Background app between send and verify, then resume.
- Validate no sensitive data appears in logs.

## 16. Migration Notes for Flutter Team
- Existing console-mode assumptions (`otp=000000` in dev response) are not valid in Akedly mode.
- OTP is now gated by challenge/solve before send.
- Verify/reset payloads can include `transactionReqID` when available; current backend also supports server-side lookup fallback.
- Any old direct OTP send logic should be replaced with the 4-step shield flow.

## 17. Reference
- Akedly docs reviewed: https://docs.akedly.io/authentication/v1-2
