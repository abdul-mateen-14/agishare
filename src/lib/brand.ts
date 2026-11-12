/**
 * Aegis Share brand constants
 * Serverless encrypted file transfer via QR + WebRTC data channels
 */

export const BRAND = {
  name: "Aegis Share",
  shortName: "Aegis",
  domain: "aegishare.pages.dev",
  tagline: "Encrypted offline + peer-to-peer file transfer",
  description:
    "Serverless, end-to-end encrypted file transfer. Small files travel as animated QR codes; large files stream directly browser-to-browser over a QR-handshaked WebRTC channel. No servers, no accounts — just a screen, a camera, and AES-GCM 256 encryption.",
  version: "2.0.0",
  // Color anchors used by Tailwind theme tokens in globals.css
  colors: {
    primary: "oklch(0.78 0.16 175)",       // emerald-teal
    primaryDim: "oklch(0.62 0.13 175)",
    accent: "oklch(0.78 0.18 50)",          // warm coral/amber
    surface: "oklch(0.16 0.02 175)",
    surfaceAlt: "oklch(0.22 0.03 175)",
    line: "oklch(0.30 0.02 175)",
  },
} as const;

export const PROTOCOL = {
  /** Magic prefix so receivers can recognise Aegis frames and ignore other QRs. */
  magic: "AEGIS1",
  /** Max raw binary bytes per chunk after base64 + JSON overhead (QR mode). */
  chunkBytes: 850,
  /** Default ms the sender dwells on each QR frame. */
  defaultFrameMs: 220,
  /** PBKDF2 iterations for passphrase-derived keys. */
  pbkdf2Iterations: 150_000,
  /** Salt length in bytes for PBKDF2. */
  saltBytes: 16,
  /** IV length in bytes for AES-GCM. */
  ivBytes: 12,
  /** AES-GCM key length in bits. */
  keyBits: 256,
  /** Max total payload (post-encryption, pre-chunking) we will accept for QR mode. */
  maxQrPayloadBytes: 1_500_000,
  /** Chunk size for streaming large-file encryption (64 KiB). */
  streamChunkBytes: 64 * 1024,
  /** Data channel message size cap (16 KiB — Chrome default). */
  dataChannelMessageBytes: 16 * 1024,
  /** Free public STUN servers used for WebRTC connection setup. */
  stunServers: [
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
    "stun:stun2.l.google.com:19302",
    "stun:stun3.l.google.com:19302",
  ],
} as const;
