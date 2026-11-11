/**
 * Signaling serialization for Aegis Share P2P mode.
 *
 * The WebRTC offer/answer SDP (with embedded ICE candidates, ~2-5 KB) is
 * carried out-of-band by the user. Two transports are supported:
 *
 *  1. QR frames — same AEGIS1 framing as the QR transfer mode, type "S",
 *     chunked because SDPs exceed one QR's capacity:
 *        AEGIS1{"m":"S","r":"offer","id":"…","i":0,"n":3,"p":"<b64 part>"}
 *
 *  2. Copy-paste code — a single compact string for laptop-to-laptop use:
 *        A1S.<base64url(JSON payload)>
 *
 * Both decode to the same SignalingPayload.
 */

import { bytesToB64, b64ToBytes, randomId } from "./crypto";
import type { FileMeta } from "./file-crypto";
import { PROTOCOL } from "./brand";
import type { SignalFrame } from "./qr-protocol";

export type { SignalFrame };

export type SignalingPayload = {
  role: "offer" | "answer";
  id: string;
  sdp: string;
  /** offer only: file metadata + key origin/salt */
  meta?: FileMeta;
  /** offer only, auto mode: base64 raw key so phones don't need a second QR */
  key?: string;
};

/* ---------- payload <-> wire ---------- */

function payloadToJson(p: SignalingPayload): string {
  return JSON.stringify(p);
}

function payloadFromJson(json: string): SignalingPayload {
  const obj = JSON.parse(json);
  if (obj.role !== "offer" && obj.role !== "answer") throw new Error("bad role");
  if (typeof obj.id !== "string" || typeof obj.sdp !== "string") {
    throw new Error("bad signaling payload");
  }
  return obj as SignalingPayload;
}

/* ---------- QR frames ---------- */

export function makeSignalFrames(
  payload: SignalingPayload,
  bytesPerFrame = 700,
): SignalFrame[] {
  const json = payloadToJson(payload);
  const b64 = bytesToB64(new TextEncoder().encode(json));
  const n = Math.max(1, Math.ceil(b64.length / bytesPerFrame));
  const frames: SignalFrame[] = [];
  for (let i = 0; i < n; i++) {
    frames.push({
      m: "S",
      r: payload.role,
      id: payload.id,
      i,
      n,
      p: b64.slice(i * bytesPerFrame, (i + 1) * bytesPerFrame),
    });
  }
  return frames;
}

export function encodeSignalFrames(frames: SignalFrame[]): string[] {
  return frames.map((f) => PROTOCOL.magic + JSON.stringify(f));
}

/* ---------- copy-paste code ---------- */

export function makeCopyPasteCode(payload: SignalingPayload): string {
  const json = payloadToJson(payload);
  const b64 = bytesToB64(new TextEncoder().encode(json))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `A1S.${b64}`;
}

export function parseCopyPasteCode(code: string): SignalingPayload | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith("A1S.")) return null;
  try {
    let b64 = trimmed.slice(4).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const json = new TextDecoder().decode(b64ToBytes(b64));
    return payloadFromJson(json);
  } catch {
    return null;
  }
}

/* ---------- accumulation (QR scan path) ---------- */

export class SignalAccumulator {
  private parts = new Map<number, string>();
  private expectedN = -1;
  private role: "offer" | "answer" | null = null;
  private sessionId: string | null = null;

  /** Returns the assembled payload when complete, else null. */
  push(frame: SignalFrame): SignalingPayload | null {
    if (this.role === null) {
      this.role = frame.r;
      this.sessionId = frame.id;
      this.expectedN = frame.n;
    } else if (this.role !== frame.r || this.sessionId !== frame.id) {
      return null; // different signal in progress — ignore
    } else if (this.expectedN !== frame.n) {
      // sender regenerated (e.g. new ICE) — reset
      this.parts.clear();
      this.expectedN = frame.n;
    }
    this.parts.set(frame.i, frame.p);
    if (this.parts.size < this.expectedN) return null;
    // assemble
    let b64 = "";
    for (let i = 0; i < this.expectedN; i++) {
      const part = this.parts.get(i);
      if (!part) return null;
      b64 += part;
    }
    try {
      const json = new TextDecoder().decode(b64ToBytes(b64));
      return payloadFromJson(json);
    } catch {
      return null;
    }
  }

  get progress(): number {
    return this.expectedN > 0 ? this.parts.size / this.expectedN : 0;
  }

  get total(): number {
    return this.expectedN;
  }

  get have(): number {
    return this.parts.size;
  }

  reset() {
    this.parts.clear();
    this.expectedN = -1;
    this.role = null;
    this.sessionId = null;
  }
}

/** New 8-char session id (also seeds deterministic chunk IVs). */
export function newSessionId(): string {
  return randomId().slice(0, 8);
}
