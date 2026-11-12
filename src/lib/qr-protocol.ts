/**
 * QR framing protocol for Aegis Share.
 *
 * Two kinds of QR frames travel over the air:
 *
 *  1. KEY frame  — `{m:"K", o:"auto"|"passphrase", k:<b64 raw key>, s:<b64 salt?>}`
 *                  The receiver scans this first to load the AES key. For
 *                  passphrase mode the salt travels here; the passphrase itself
 *                  is shared out-of-band (verbally, by SMS, etc.).
 *
 *  2. DATA frame — `{m:"D", i:<chunkIndex 0..n-1>, n:<totalChunks>,
 *                    s:<sessionId>, h:<sha256-hex of full ciphertext>,
 *                    d:<base64 chunk of ciphertext>}`
 *
 * The sender broadcasts:
 *   KEY frame  ->  DATA 0  ->  DATA 1  -> ... ->  DATA n-1  ->  repeat
 *
 * The receiver accumulates DATA frames by `s` (session id). When n unique
 * frames for session `s` are present AND their concatenated bytes hash to `h`,
 * the ciphertext is complete and ready for decryption.
 *
 * Frames are prefixed with the Aegis magic so the scanner can ignore other QR
 * codes the camera happens to see (event tickets, URL QRs, etc.).
 *
 * For large-file mode (WebRTC) the same magic prefix wraps signaling frames:
 *
 *  3. SIGNAL frame — `{m:"S", role:"offer"|"answer", id:<sessionId>,
 *                      i:<idx>, n:<total>, sdp:<base64 SDP>,
 *                      meta?:<base64 JSON of {name,size,mime,salt,totalChunks,hash}>}`
 *                     Only the offer carries `meta`. The role's sender shows
 *                     these QRs; the other side scans and reconstructs the
 *                     full SDP, then shows its own SIGNAL frames back.
 */

import { PROTOCOL } from "./brand";
import {
  bytesToB64,
  b64ToBytes,
  sha256Hex,
} from "./crypto";

export type KeyFrame = {
  m: "K";
  o: "passphrase" | "auto";
  k: string; // base64 raw AES key
  s?: string; // base64 salt (passphrase mode only)
};

export type DataFrame = {
  m: "D";
  i: number; // chunk index, 0-based
  n: number; // total chunks
  s: string; // session id (short)
  h: string; // sha256 hex of the full ciphertext
  d: string; // base64 chunk of ciphertext
};

export type SignalFrame = {
  m: "S";
  r: "offer" | "answer";
  id: string;
  i: number;
  n: number;
  p: string; // base64 chunk of the signaling JSON
};

export type AnyFrame = KeyFrame | DataFrame | SignalFrame;

/* ---------- frame (de)serialisation ---------- */

export function encodeFrame(frame: AnyFrame): string {
  return PROTOCOL.magic + JSON.stringify(frame);
}

export function decodeFrame(raw: string): AnyFrame | null {
  if (!raw.startsWith(PROTOCOL.magic)) return null;
  try {
    const obj = JSON.parse(raw.slice(PROTOCOL.magic.length));
    if (
      obj &&
      typeof obj === "object" &&
      (obj.m === "K" || obj.m === "D" || obj.m === "S")
    ) {
      return obj as AnyFrame;
    }
  } catch {
    /* ignore malformed */
  }
  return null;
}

/* ---------- chunking ---------- */

export type ChunkedPayload = {
  sessionId: string;
  totalChunks: number;
  hashHex: string;
  frames: string[]; // pre-encoded DATA frame strings, in order
};

/** Split a ciphertext blob into chunked DATA frame strings. */
export async function chunkPayload(
  ciphertextB64: string,
  sessionId: string,
): Promise<ChunkedPayload> {
  const ctBytes = b64ToBytes(ciphertextB64);
  const hashHex = await sha256Hex(ctBytes);
  const chunkSize = PROTOCOL.chunkBytes;
  const totalChunks = Math.max(1, Math.ceil(ctBytes.length / chunkSize));
  if (totalChunks * chunkSize < ctBytes.length) {
    // safety, should not happen
    throw new Error("chunk math error");
  }
  const frames: string[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const slice = ctBytes.subarray(i * chunkSize, (i + 1) * chunkSize);
    const frame: DataFrame = {
      m: "D",
      i,
      n: totalChunks,
      s: sessionId,
      h: hashHex,
      d: bytesToB64(slice),
    };
    frames.push(encodeFrame(frame));
  }
  return { sessionId, totalChunks, hashHex, frames };
}

/** Reassemble received chunks into ciphertext bytes. Returns null if incomplete. */
export type ReassembleResult =
  | { ok: true; ciphertext: Uint8Array; hashHex: string; totalChunks: number }
  | { ok: false; reason: "incomplete" | "hash_mismatch"; hashHex?: string };

export function reassemble(
  sessionId: string,
  chunks: Map<number, Uint8Array>,
  expectedTotal: number,
  expectedHash: string,
): ReassembleResult {
  if (chunks.size < expectedTotal) return { ok: false, reason: "incomplete" };
  const total: number[] = [];
  for (let i = 0; i < expectedTotal; i++) {
    const c = chunks.get(i);
    if (!c) return { ok: false, reason: "incomplete" };
    total.push(...c);
  }
  const assembled = new Uint8Array(total);
  // Hash-check is async but cheap; do it lazily in caller for now. We expose
  // the assembled bytes here and let caller verify.
  return {
    ok: true,
    ciphertext: assembled,
    hashHex: expectedHash,
    totalChunks: expectedTotal,
  };
}

export async function verifyHash(
  bytes: Uint8Array,
  expectedHex: string,
): Promise<boolean> {
  return (await sha256Hex(bytes)) === expectedHex;
}
