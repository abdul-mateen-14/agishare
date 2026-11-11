/**
 * Link mode — laptop-friendly small-file transfer via URL fragment.
 *
 * The encrypted payload (and, in auto-key mode, the AES key itself) lives in
 * the URL fragment:  https://aegishare.pages.dev/#a1.a.<salt>.<key>.<data>
 *
 * URL fragments are NEVER sent to the server — Cloudflare Pages only ever
 * sees a request for "/". Decryption happens entirely in the receiver's
 * browser, so hosting stays serverless even though a link exists.
 *
 * Two key modes:
 *  - "auto"    — key embedded in the link. Whoever has the link can decrypt.
 *                Like a secret URL / magic link.
 *  - "pass"    — only the salt travels in the link; the passphrase is shared
 *                out-of-band (verbally, chat, etc). Link alone is useless.
 *
 * Segment format (dot-separated base64url, no padding):
 *   #a1.<mode>.<saltB64u>.<keyB64u or '-'>.<dataB64u>
 */

const PREFIX = "#a1.";

export type LinkPayload = {
  keyOrigin: "auto" | "passphrase";
  /** base64 PBKDF2 salt */
  salt: string;
  /** base64 raw AES key — only present in auto mode */
  key: string | null;
  /** base64 encrypted blob (iv || ct), same shape as QR mode */
  data: string;
};

/* ---------- base64url helpers ---------- */

function b64ToB64u(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uToB64(s: string): string {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return b64;
}

/* ---------- build / parse ---------- */

export function buildLink(
  base: string,
  keyOrigin: "auto" | "passphrase",
  saltB64: string,
  keyB64: string | null,
  encryptedDataB64: string,
): string {
  const seg = [
    "a1",
    keyOrigin === "auto" ? "a" : "p",
    b64ToB64u(saltB64),
    keyB64 ? b64ToB64u(keyB64) : "-",
    b64ToB64u(encryptedDataB64),
  ].join(".");
  const clean = base.replace(/\/+$/, "");
  return `${clean}/#${seg}`;
}

export function parseLink(hash: string): LinkPayload | null {
  if (!hash || !hash.startsWith(PREFIX)) return null;
  try {
    // hash = "#a1.<mode>.<salt>.<key|->.<data>" — the "a1" version tag is
    // validated by the prefix, so segments after it are 4.
    const seg = hash.slice(PREFIX.length).split(".");
    if (seg.length !== 4) return null;
    const [modeRaw, saltB64u, keyB64u, dataB64u] = seg;
    if (modeRaw !== "a" && modeRaw !== "p") return null;
    const salt = b64uToB64(saltB64u);
    const key = keyB64u === "-" ? null : b64uToB64(keyB64u);
    const data = b64uToB64(dataB64u);
    if (!salt || !data) return null;
    if (modeRaw === "a" && !key) return null;
    return {
      keyOrigin: modeRaw === "a" ? "auto" : "passphrase",
      salt,
      key,
      data,
    };
  } catch {
    return null;
  }
}

/** Soft max for the data segment before some chat apps start truncating. */
export const LINK_SAFE_CHARS = 4096;
/** Hard cap — beyond this QR or P2P mode is the right tool. */
export const LINK_MAX_CHARS = 120_000;
