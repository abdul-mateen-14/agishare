# Aegis Share — deployment guide

## 1. Build the static site

```bash
bun install
bun run build
```

This produces `out/` — pure static files. No server, no API routes.

## 2. Deploy to Cloudflare Pages

### Option A — wrangler CLI

```bash
bun run deploy:cf
# or, with custom project name:
npx wrangler pages deploy out --project-name aegis-share
```

### Option B — drag-and-drop

1. Run `bun run build`
2. Open the Cloudflare Pages dashboard → Create a project → Direct Upload
3. Drag the `out/` folder in
4. The deployed URL will be `https://aegis-share.pages.dev` (or whatever name you chose)

## 3. The edge worker (Download Booster)

The `functions/api/fetch.ts` file is automatically picked up by Cloudflare
Pages Functions on deploy — it serves `https://<your-project>.pages.dev/api/fetch`
and powers the Download Booster mode.

The worker:
- Fetches the target URL through Cloudflare's edge network with HTTP/2 + warm TLS
- Caches the response in the Cloudflare Cache API (subsequent downloads are instant)
- Streams the body to your browser at full link speed
- Forwards Range requests transparently (resuming works)
- Refuses private IPs / loopback / cloud metadata endpoints (SSRF guard)

### Optional: lock down the worker

By default anyone can use your `/api/fetch`. To require an HMAC signature:

1. Cloudflare Pages dashboard → your project → Settings → Environment
   variables
2. Add `AEGIS_BOOSTER_SECRET` with a random string (e.g. `openssl rand -hex 32`)
3. Save and redeploy

Now callers must pass `?sig=<hex>` derived from HMAC-SHA256(secret, url). The
UI automatically signs requests when this env var is detected on the worker
side via the metadata endpoint.

## 4. Local development

```bash
bun run dev     # Next.js dev server on :3000
```

Note: the Download Booster's edge worker only runs on Cloudflare Pages, not
in the local dev server. In local dev, the booster UI will show a graceful
"probe failed" message — this is expected. Test the booster on the deployed
site.

## Modes summary

| Mode | Range | Best for | Server |
| --- | --- | --- | --- |
| QR codes | up to ~1.5 MB | phone-to-phone, air-gapped | none |
| Share link | up to ~90 KB | laptop-to-laptop, no camera | none |
| Direct P2P | MB to GB | large files, Wi-Fi/LAN | none (STUN only) |
| Download Booster | anything public | slow URLs, GitHub releases | Cloudflare edge worker |

All four are accessible from the Send tab. Link mode auto-receives when you
open a `#a1.…` URL on the deployed site.

## Tech stack

- Next.js 16 (App Router, static export)
- TypeScript 5, Tailwind CSS 4, shadcn/ui
- Web Crypto API (AES-GCM 256, PBKDF2)
- qrcode + jsQR for QR encoding/decoding
- Native WebRTC API for P2P streaming
- Cloudflare Pages Functions for the edge worker
- Bun for dev/install
