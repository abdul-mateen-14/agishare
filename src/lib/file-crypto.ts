/**
 * Streaming file encryption for large-file P2P transfers.
 *
 * Files are encrypted in 64 KiB chunks using AES-GCM 256 with a
 * deterministic per-chunk IV:  sessionId (8 bytes) || chunkIndex (4 bytes LE).
 *
 * Deterministic IVs are safe here because the (key, iv) pair is unique per
 * chunk index — a fresh 256-bit AES key is minted for every transfer session,
 * and GCM's auth tag guarantees each chunk's integrity, so no separate
 * whole-file hash is required for multi-GB payloads.
 *
 * The sender streams File.slice(i*chunk, ...) → encrypt → WebRTC data channel.
 * The receiver decrypts each chunk as it arrives and accumulates Blob parts,
 * so memory usage stays flat regardless of file size.
 */

import { PROTOCOL } from "./brand";
import { b64ToBytes, bytesToB64 } from "./crypto";

const CHUNK = PROTOCOL.streamChunkBytes; // 64 KiB

export type FileMeta = {
  /** random 8-char session id — also seeds the deterministic IVs */
  id: string;
  name: string;
  size: number;
  mime: string;
  chunkSize: number;
  totalChunks: number;
  /** base64 PBKDF2 salt (passphrase mode) */
  salt?: string;
  /** keyOrigin so the receiver knows whether to expect a passphrase */
  keyOrigin: "passphrase" | "auto";
};

export function makeFileMeta(
  file: File,
  sessionId: string,
  keyOrigin: "passphrase" | "auto",
  saltB64?: string,
): FileMeta {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK));
  return {
    id: sessionId,
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
    chunkSize: CHUNK,
    totalChunks,
    salt: saltB64,
    keyOrigin,
  };
}

/** Deterministic 12-byte IV: sessionId (8 bytes) || chunkIndex LE (4 bytes). */
export function ivForChunk(sessionId: string, chunkIndex: number): Uint8Array {
  const idBytes = new TextEncoder().encode(sessionId);
  const iv = new Uint8Array(12);
  iv.set(idBytes.subarray(0, 8), 0);
  // chunkIndex little-endian, 4 bytes
  iv[8] = chunkIndex & 0xff;
  iv[9] = (chunkIndex >>> 8) & 0xff;
  iv[10] = (chunkIndex >>> 16) & 0xff;
  iv[11] = (chunkIndex >>> 24) & 0xff;
  return iv;
}

/**
 * Encrypt one chunk. Returns ct bytes (plaintext length + 16-byte GCM tag).
 * `keyHandle` is a CryptoKey from deriveKeyFromPassphrase / generateAutoKey.
 */
export async function encryptChunk(
  keyHandle: CryptoKey,
  sessionId: string,
  chunkIndex: number,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const iv = ivForChunk(sessionId, chunkIndex);
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    keyHandle,
    plaintext as BufferSource,
  );
  return new Uint8Array(ctBuf);
}

/**
 * Decrypt one chunk. Returns plaintext bytes.
 * Throws if the GCM auth tag fails (wrong key or corrupt data).
 */
export async function decryptChunk(
  keyHandle: CryptoKey,
  sessionId: string,
  chunkIndex: number,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const iv = ivForChunk(sessionId, chunkIndex);
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    keyHandle,
    ciphertext as BufferSource,
  );
  return new Uint8Array(ptBuf);
}

/** Read one chunk of a File starting at byte offset. */
export async function readChunk(file: File, index: number): Promise<Uint8Array> {
  const start = index * CHUNK;
  const end = Math.min(start + CHUNK, file.size);
  const buf = await file.slice(start, end).arrayBuffer();
  return new Uint8Array(buf);
}

/* ---------------- wire format ----------------
 * Binary data-channel message: [chunkIndex u32 LE][ciphertext…]
 * Control messages are JSON strings: {"c":"meta"| "done" | "error", …}
 * --------------------------------------------- */

export function packChunkMessage(chunkIndex: number, ct: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(4 + ct.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, chunkIndex, true); // little-endian
  out.set(ct, 4);
  return out.buffer as ArrayBuffer;
}

export function unpackChunkMessage(data: ArrayBuffer): {
  chunkIndex: number;
  ct: Uint8Array;
} {
  const dv = new DataView(data);
  const chunkIndex = dv.getUint32(0, true);
  const ct = new Uint8Array(data, 4);
  return { chunkIndex, ct: new Uint8Array(ct) };
}

/** Serialize FileMeta for the wire (base64 JSON). */
export function packMeta(meta: FileMeta): string {
  return bytesToB64(new TextEncoder().encode(JSON.stringify(meta)));
}

export function unpackMeta(b64: string): FileMeta {
  const json = new TextDecoder().decode(b64ToBytes(b64));
  const obj = JSON.parse(json);
  if (typeof obj.id !== "string" || typeof obj.size !== "number") {
    throw new Error("bad meta");
  }
  return obj as FileMeta;
}
