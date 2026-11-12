# Aegis Share

Serverless, end-to-end encrypted file transfer. Four ways to move data
without a server. All the crypto and transfer logic runs in your browser —
the deployment is pure static files, perfect for Cloudflare Pages.

**Live**: <https://aegishare.pages.dev>

## Four transfer modes

| Mode | Best for | Range | Network? |
| --- | --- | --- | --- |
| **QR codes** | Phone ↔ anything with a camera | up to ~1.5 MB | None — pure screen-to-camera |
| **Share links** | Laptop ↔ laptop (no camera) | up to ~90 KB per link | None — payload rides in URL fragment |
| **Direct P2P** | Real files, any two browsers | MB to GB | WebRTC data channel (direct, no relay) |
| **Download Booster** | Fast-fetching slow public URLs | any size | Cloudflare Pages Function (edge proxy) |

## How it works

1. **Encrypt locally.** Everything is encrypted in your browser with the
   Web Crypto API (AES-GCM 256). Keys never leave the device unencrypted.
2. **Share the key out-of-band.** Passphrase mode derives the AES key via
   PBKDF2-SHA256 (150k iterations, random salt). Auto mode mints a random
   256-bit key you scan or paste once.
3. **Move data over the side channel.** QR frames, URL fragments, or
   WebRTC signaling codes — pick whatever the two devices can do.
4. **Verify and decrypt on the receiver.** Hash checks on QR mode, GCM
   auth tags everywhere else. Plaintext never exists on any server,
   because there isn't one.

## Service worker (offline support)

After your first visit, the site installs a service worker that caches
the app shell + Next.js chunks + fonts. Open the page once online and
you can use **QR codes**, **Share links**, and **Direct P2P** fully
offline after that. (The Download Booster requires network because it's
a proxy — the SW never caches `/api/*`.)

## Tech stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4 (oklch colors) + shadcn/ui
- Zustand for state
- Web Crypto API for all crypto
- WebRTC DataChannel for P2P
- qrcode + jsqr for QR codes
- Cloudflare Pages (static export) + Pages Function (booster)

## Develop

```bash
bun install
bun run dev          # http://localhost:3000
bun run lint
bun run build        # static export to out/
bun run scripts/test-roundtrip.ts   # 49 assertions
```

## Deploy

```bash
# Static export → Cloudflare Pages
bun run deploy:cf
# Wrangler uploads out/ as static assets + functions/ as Pages Functions.
```

Or use the Cloudflare dashboard "Direct Upload" by dragging the contents
of `out/` after `bun run build`.

## License

MIT.
