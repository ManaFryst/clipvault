# ClipVault

**End-to-end encrypted one-time secret relay.**  
Copy passwords between devices without a password manager.

---

## How It Works

1. Paste your secret on **Device A**
2. Browser encrypts it with AES-256-GCM (client-side, key never leaves your device)
3. Only ciphertext is sent to the server
4. Server returns a 5-digit ID and the page shows a link + QR code
5. **Device B** scans the QR or opens the link
6. Browser decrypts locally using the key in the URL fragment (`#...`)
7. Secret is copied to clipboard and the server entry is permanently deleted

The server **never** sees your plaintext. The decryption key lives only in the URL fragment — it is never sent to the server in HTTP requests.

---

## Quick Start (Node.js)

```bash
npm install
node server.js
# → http://localhost:3000
```

---

## Docker

```bash
# Build and run
docker compose up -d

# Custom expiry (e.g. 2 minutes)
EXPIRY_MS=120000 docker compose up -d
```

Or build manually:
```bash
docker build -t clipvault .
docker run -p 3000:3000 -e EXPIRY_MS=60000 clipvault
```

---

## Reverse Proxy (Caddy — for homelab with HTTPS)

Add to your Caddyfile:

```
clip.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Then access at `https://clip.yourdomain.com` — HTTPS is required for the Clipboard API to work on the retrieve page.

---

## Environment Variables

| Variable    | Default | Description                        |
|-------------|---------|------------------------------------|
| `PORT`      | `3000`  | Server port                        |
| `EXPIRY_MS` | `60000` | Default secret expiry (ms)         |

---

## Security Properties

- **AES-256-GCM** encryption with a random key per secret
- **Key never sent to server** — lives in URL fragment (`#key`)
- **One-time read** — server deletes immediately on first GET
- **Auto-expiry** — unclaimed secrets purged after timeout (default 60s, max 5 min)
- **In-memory only** — no disk persistence, no logging of payloads
- **Rate limiting** — 30 req/min per IP on send/get endpoints
- **Max payload** — 10KB

---

## Endpoints

```
POST /send        Body: { ciphertext, iv, salt, expiry? }
                  Returns: { id, expires_in }

GET  /get/:id     Returns ciphertext once, then deletes
                  Returns: { ciphertext, iv, salt }

GET  /status      Health check (no secret data)
```
