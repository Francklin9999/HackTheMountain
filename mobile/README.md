# Sillon Mobile

This Expo app is a second frontend for the existing Sillon backend.

## What it does

- scans via the normal Expo QR flow
- records a humming sample on the phone and posts it to `/api/match`
- supports assisted matching through `/api/match/assisted`
- loads artist dossiers from `/api/artists/:id`
- plays matched archive audio returned by the backend

## With Docker Compose

From the repo root:

```bash
docker compose up --build
```

That starts:

- web frontend on `http://localhost:3000`
- API on `http://localhost:8000`
- Expo dev server in the `mobile` service

Follow the Expo QR code in the `mobile` service logs:

```bash
docker compose logs -f mobile
```

## Backend discovery

The mobile app tries to infer the API host from Expo's `hostUri`, so when your phone scans a QR code like `exp://192.168.1.50:8081`, the app will default to `http://192.168.1.50:8000`.

If your network setup is unusual, set:

```bash
EXPO_PUBLIC_API_URL=http://YOUR-LAN-IP:8000
```

or overwrite the API URL directly in the app's connection field.

## Note

The Compose setup uses `network_mode: host` for the Expo service, which is the smoothest option on Linux when you want QR scanning from a phone on the same Wi-Fi network.
