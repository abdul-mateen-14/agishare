/**
 * COREX brand constants — corex.site.je
 * Serverless encrypted QR transfer platform
 */

export const BRAND = {
  name: "COREX",
  domain: "corex.site.je",
  tagline: "Encrypted offline transfer via QR",
  description:
    "Serverless, end-to-end encrypted data transfer using animated QR codes. No servers, no accounts, no network — works on any device with a camera.",
  version: "1.0.0",
  // Color anchors used by Tailwind theme tokens in globals.css
  colors: {
    primary: "oklch(0.78 0.16 175)",       // emerald-teal
    primaryDim: "oklch(0.62 0.13 175)",
    accent: "oklch(0.78 0.18 50)",          // warm coral/amber
    surface: "oklch(0.16 0.02 175)",       // dark teal-tinted slate
    surfaceAlt: "oklch(0.22 0.03 175)",
    line: "oklch(0.30 0.02 175)",
  },
} as const;

export const PROTOCOL = {
  /** Magic prefix so receivers can recognise COREX frames and ignore other QRs. */
  magic: "COREX1",
  /** Max raw binary bytes per chunk after base64 + JSON overhead. */
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
  /** Max total payload (post-encryption, pre-chunking) we will accept. */
  maxPayloadBytes: 1_500_000,
} as const;
