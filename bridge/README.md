# Bloom HTTP Bridge (ESP32 HTTP -> Firestore)

This bridge allows ESP32 firmware to use HTTP (not HTTPS) while the server syncs with Firestore.

## Why this exists

- ESP32 firmware in this project is testing-oriented and uses HTTP endpoints.
- Firestore APIs are HTTPS-only.
- The bridge translates between ESP32 HTTP calls and Firestore writes/reads.

## Endpoints

- `GET /health`
- `POST /v1/device/register`
- `POST /v1/device/heartbeat`
- `GET /v1/device/commands?deviceId=<id>&token=<token>`
- `POST /v1/device/ack`

## Firestore collections used

- `tracker_devices`
- `tracker_commands`
- `mode_test_runs`

## Setup

1. Copy `.env.example` to `.env` and set values.
2. Provide a Firebase service account JSON and export:
   - `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json`
3. Install dependencies:

```bash
cd bridge
npm install
```

4. Start server:

```bash
npm start
```

## ESP32 firmware config

Set these constants in firmware:

- `BRIDGE_BASE_URL` -> this server URL over HTTP
- `AUTH_TOKEN` -> same as `.env` `DEVICE_TOKEN`

## Security note

For production, keep this bridge behind a private network/VPN and restrict device tokens.

## Deploy on Fly.io (fast path)

1. Install and login:

```bash
fly auth login
```

2. Initialize app from the `bridge` folder:

```bash
cd bridge
fly launch --no-deploy
```

3. Edit generated `fly.toml` and make sure HTTP is allowed for SIM800 calls:

```toml
[http_service]
   internal_port = 8080
   force_https = false
```

4. Add secrets (no local key file required):

```bash
fly secrets set FIREBASE_PROJECT_ID=bloom-1bbbc
fly secrets set DEVICE_TOKEN=replace-device-token
fly secrets set FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

Optional: use base64 instead of raw JSON:

```bash
fly secrets set FIREBASE_SERVICE_ACCOUNT_B64="<base64-json>"
```

5. Deploy:

```bash
fly deploy
```

6. Check health:

```bash
fly status
curl http://<your-app>.fly.dev/health
```

7. Set firmware bridge URL:

- Use `http://<your-app>.fly.dev` in firmware `BRIDGE_BASE_URL`.
- Keep firmware `AUTH_TOKEN` equal to Fly secret `DEVICE_TOKEN`.
