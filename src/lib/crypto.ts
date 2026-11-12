/**
 * Web Crypto wrappers — zero-dependency, runs in every modern browser.
 *
 * Encryption: AES-GCM 256-bit, random 96-bit IV per payload, authenticated.
 * Key derivation: PBKDF2-SHA256 with a random 16-byte salt + passphrase.
 * Auto-key: random 256-bit AES key generated locally and exported as raw bytes
 *           so the sender can show it as a separate Key QR.
 *
 * All ciphertext/key material is base64-encoded so it can live inside a JSON
 * QR frame or a Key QR.
 */

const PBKDF2_ITERATIONS = 150_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

export type KeyMaterial = {
  /** base64 raw key bytes — 32 bytes for AES-256 */
  raw: string;
  /** "passphrase" if derived from a passphrase, "auto" if randomly generated */
  origin: "passphrase" | "auto";
  /** The CryptoKey handle for use with AES-GCM */
  handle: CryptoKey;
};

export type EncryptedPayload = {
  /** base64 IV (12 bytes) */
  iv: string;
  /** base64 ciphertext+authTag */
  ct: string;
  /** base64 salt (16 bytes) — only set when key was passphrase-derived */
  salt?: string;
  /** "passphrase" | "auto" — tells receiver how to derive the key */
  keyOrigin: "passphrase" | "auto";
};

/* ---------- base64 helpers (UTF-8 safe) ---------- */

export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function bytesToStr(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

/* ---------- random ---------- */

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function randomId(): string {
  // 12-char base32-ish id, good enough to tag a transfer session
  const b = randomBytes(8);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < b.length; i++) out += alphabet[b[i] % 32];
  return out;
}

/* ---------- key handling ---------- */

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    rawKey as BufferSource,
    { name: "AES-GCM", length: KEY_BITS },
    true,
    ["encrypt", "decrypt"],
  );
}

/** Derive an AES-256 key from a passphrase + fresh random salt (PBKDF2). */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array = randomBytes(SALT_BYTES),
): Promise<{ key: KeyMaterial; salt: Uint8Array }> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    strToBytes(passphrase) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const derived = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: KEY_BITS },
    true,
    ["encrypt", "decrypt"],
  );
  const rawBuf = await crypto.subtle.exportKey("raw", derived);
  return {
    key: {
      raw: bytesToB64(new Uint8Array(rawBuf)),
      origin: "passphrase",
      handle: derived,
    },
    salt,
  };
}

/** Generate a random 256-bit AES key and export its raw bytes. */
export async function generateAutoKey(): Promise<KeyMaterial> {
  const raw = randomBytes(KEY_BITS / 8);
  const handle = await importAesKey(raw);
  return {
    raw: bytesToB64(raw),
    origin: "auto",
    handle,
  };
}

/** Rehydrate a KeyMaterial from a base64 raw key (used by the receiver). */
export async function keyFromRaw(
  rawB64: string,
  origin: "passphrase" | "auto",
): Promise<KeyMaterial> {
  const raw = b64ToBytes(rawB64);
  return {
    raw: rawB64,
    origin,
    handle: await importAesKey(raw),
  };
}

/* ---------- encrypt / decrypt ---------- */

export async function encrypt(
  key: KeyMaterial,
  plaintext: Uint8Array,
): Promise<EncryptedPayload> {
  const iv = randomBytes(IV_BYTES);
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key.handle,
    plaintext as BufferSource,
  );
  const ct = new Uint8Array(ctBuf);
  return {
    iv: bytesToB64(iv),
    ct: bytesToB64(ct),
    keyOrigin: key.origin,
    // salt isn't needed in the payload — it travels inside the Key QR for
    // passphrase mode, OR is irrelevant for auto mode.
  };
}

export async function decrypt(
  key: KeyMaterial,
  payload: EncryptedPayload,
): Promise<Uint8Array> {
  const iv = b64ToBytes(payload.iv);
  const ct = b64ToBytes(payload.ct);
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key.handle,
    ct as BufferSource,
  );
  return new Uint8Array(ptBuf);
}

/* ---------- combined iv||ct format (used by the QR protocol) ---------- */

/**
 * Encrypt and return a single byte blob = iv (12 bytes) || ct+authTag.
 * Base64 of this blob is what gets chunked into QR frames, so the IV
 * implicitly travels inside chunk 0. No separate IV channel is needed.
 */
export async function encryptCombined(
  key: KeyMaterial,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const iv = randomBytes(IV_BYTES);
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key.handle,
    plaintext as BufferSource,
  );
  const ct = new Uint8Array(ctBuf);
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_BYTES);
  return out;
}

/** Decrypt a blob produced by encryptCombined: first 12 bytes are IV. */
export async function decryptCombined(
  key: KeyMaterial,
  combined: Uint8Array,
): Promise<Uint8Array> {
  if (combined.length < IV_BYTES + 16) {
    throw new Error("Payload too short — wrong key or corrupt data");
  }
  const iv = combined.subarray(0, IV_BYTES);
  const ct = combined.subarray(IV_BYTES);
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key.handle,
    ct as BufferSource,
  );
  return new Uint8Array(ptBuf);
}

/* ---------- SHA-256 integrity check (per payload) ---------- */

export async function sha256Hex(input: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", input as BufferSource);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
