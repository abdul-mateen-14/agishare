/**
 * WebRTC engine for Aegis Share large-file transfers.
 *
 * Direct browser-to-browser transfer over WebRTC data channels — the browser
 * equivalent of AirDrop / Nearby Share. Traffic flows directly between the
 * two devices (over Wi-Fi/LAN or the internet via NAT hole-punching). No
 * server relays file bytes; the only external endpoints are free public STUN
 * servers used to discover each peer's public IP:port during setup.
 *
 * Signaling (the tiny SDP offer/answer exchange) is done out-of-band by the
 * user via Aegis QR frames or a copy-paste code — see webrtc-signaling.ts.
 *
 * File bytes never travel unencrypted: every 64 KiB chunk is AES-GCM
 * encrypted (file-crypto.ts) BEFORE it enters the data channel.
 */

import { PROTOCOL } from "./brand";
import {
  encryptChunk,
  decryptChunk,
  packChunkMessage,
  unpackChunkMessage,
  type FileMeta,
} from "./file-crypto";

/* ---------- peer connection helpers ---------- */

export function createPeer(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: PROTOCOL.stunServers.map((urls) => ({ urls })),
    iceCandidatePoolSize: 4,
  });
}

/** Resolve once ICE gathering finishes (or after a grace timeout). */
export function waitForIce(pc: RTCPeerConnection, timeoutMs = 3500): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

/* ---------- sender ---------- */

export type SenderEvents = {
  onConnected?: () => void;
  onProgress?: (sentChunks: number, totalChunks: number, bytesPerSec: number) => void;
  onDone?: () => void;
  onError?: (msg: string) => void;
  onDataChannel?: (dc: RTCDataChannel) => void;
};

export class P2pSender {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null = null;
  private file: File | null = null;
  private meta: FileMeta | null = null;
  private keyHandle: CryptoKey | null = null;
  private cancelled = false;
  private ev: SenderEvents;

  constructor(events: SenderEvents) {
    this.ev = events;
    this.pc = createPeer();
    // sender creates the data channel
    this.dc = this.pc.createDataChannel("aegis-file", { ordered: true });
    this.ev.onDataChannel?.(this.dc);
    this.dc.bufferedAmountLowThreshold = 512 * 1024;
    this.dc.onopen = () => {
      this.ev.onConnected?.();
      void this.pump();
    };
    this.dc.onerror = () => {
      this.ev.onError?.("Data channel error");
    };
  }

  async start(file: File, meta: FileMeta, keyHandle: CryptoKey): Promise<void> {
    this.file = file;
    this.meta = meta;
    this.keyHandle = keyHandle;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIce(this.pc);
  }

  async acceptAnswer(answerSdp: string): Promise<void> {
    await this.pc.setRemoteDescription(
      { type: "answer", sdp: answerSdp } as RTCSessionDescriptionInit,
    );
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Wait until the buffered amount drains below the low threshold. */
  private async waitForDrain(): Promise<void> {
    const dc = this.dc;
    if (!dc) return;
    const HIGH = 8 * 1024 * 1024; // 8 MiB in flight max
    while (dc.bufferedAmount > HIGH && !this.cancelled && dc.readyState === "open") {
      await new Promise<void>((resolve) => {
        const onLow = () => {
          dc.removeEventListener("bufferedamountlow", onLow);
          resolve();
        };
        dc.addEventListener("bufferedamountlow", onLow);
        // safety poll in case the event was missed
        setTimeout(() => {
          dc.removeEventListener("bufferedamountlow", onLow);
          resolve();
        }, 250);
      });
    }
  }

  private async pump(): Promise<void> {
    const dc = this.dc;
    if (!dc || !this.file || !this.meta || !this.keyHandle) return;
    const startedAt = performance.now();
    try {
      // 1) send meta as a control message
      dc.send(JSON.stringify({ c: "meta", meta: this.meta }));

      // 2) stream encrypted chunks
      for (let i = 0; i < this.meta.totalChunks; i++) {
        if (this.cancelled || dc.readyState !== "open") return;
        const pt = await this.file
          .slice(i * this.meta.chunkSize, (i + 1) * this.meta.chunkSize)
          .arrayBuffer();
        const ct = await encryptChunk(
          this.keyHandle,
          this.meta.id,
          i,
          new Uint8Array(pt),
        );
        dc.send(packChunkMessage(i, ct));

        if (i % 4 === 0 || i === this.meta.totalChunks - 1) {
          await this.waitForDrain();
        }
        if (i % 8 === 0 || i === this.meta.totalChunks - 1) {
          const elapsed = (performance.now() - startedAt) / 1000;
          const sent = Math.min((i + 1) * this.meta.chunkSize, this.meta.size);
          this.ev.onProgress?.(i + 1, this.meta.totalChunks, elapsed > 0 ? sent / elapsed : 0);
        }
      }

      // 3) done
      dc.send(JSON.stringify({ c: "done" }));
      this.ev.onDone?.();
    } catch (e) {
      this.ev.onError?.(e instanceof Error ? e.message : String(e));
    }
  }

  cancel() {
    this.cancelled = true;
    this.dc?.close();
    this.pc.close();
  }
}

/* ---------- receiver ---------- */

export type ReceiverEvents = {
  onConnected?: () => void;
  onMeta?: (meta: FileMeta) => void;
  onProgress?: (gotChunks: number, totalChunks: number, bytesPerSec: number) => void;
  onDone?: (blob: Blob) => void;
  onError?: (msg: string) => void;
};

export class P2pReceiver {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null = null;
  private meta: FileMeta | null = null;
  private keyHandle: CryptoKey | null = null;
  private parts: ArrayBuffer[] = [];
  private gotChunks = 0;
  private startedAt = 0;
  private ev: ReceiverEvents;
  private expectedSize = -1;

  constructor(events: ReceiverEvents) {
    this.ev = events;
    this.pc = createPeer();
    this.pc.ondatachannel = (e) => {
      this.dc = e.channel;
      this.dc.binaryType = "arraybuffer";
      this.startedAt = performance.now();
      this.dc.onmessage = (ev) => void this.onMessage(ev.data);
      this.dc.onopen = () => this.ev.onConnected?.();
      this.dc.onerror = () => this.ev.onError?.("Data channel error");
    };
  }

  async acceptOffer(offerSdp: string): Promise<void> {
    await this.pc.setRemoteDescription(
      { type: "offer", sdp: offerSdp } as RTCSessionDescriptionInit,
    );
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitForIce(this.pc);
  }

  prepare(meta: FileMeta, keyHandle: CryptoKey) {
    this.meta = meta;
    this.keyHandle = keyHandle;
    this.expectedSize = meta.size;
    this.ev.onMeta?.(meta);
  }

  private async onMessage(data: string | ArrayBuffer) {
    try {
      if (typeof data === "string") {
        const msg = JSON.parse(data) as { c: string; meta?: FileMeta; m?: string };
        if (msg.c === "meta" && msg.meta) {
          // channel meta overrides offer meta if present
          if (!this.meta) this.prepare(msg.meta, this.keyHandle!);
          else this.meta = msg.meta;
          this.expectedSize = msg.meta.size;
          return;
        }
        if (msg.c === "done") {
          await this.finish();
          return;
        }
        if (msg.c === "error") {
          this.ev.onError?.(msg.m ?? "Sender reported an error");
          return;
        }
        return;
      }

      // binary chunk
      if (!this.meta || !this.keyHandle) {
        throw new Error("Got chunk before meta/key");
      }
      const { chunkIndex, ct } = unpackChunkMessage(data);
      const pt = await decryptChunk(this.keyHandle, this.meta.id, chunkIndex, ct);
      this.parts.push(pt as unknown as ArrayBuffer);
      // we pushed a Uint8Array view — copy to a standalone ArrayBuffer so the
      // Blob construction later works with detached buffers
      this.parts[this.parts.length - 1] = pt.slice().buffer as ArrayBuffer;
      this.gotChunks++;

      const elapsed = (performance.now() - this.startedAt) / 1000;
      const got = this.parts.reduce((a, b) => a + b.byteLength, 0);
      this.ev.onProgress?.(
        this.gotChunks,
        this.meta.totalChunks,
        elapsed > 0 ? got / elapsed : 0,
      );
    } catch (e) {
      this.ev.onError?.(e instanceof Error ? e.message : String(e));
    }
  }

  private async finish() {
    // sanity: all chunks present and size matches
    const total = this.parts.reduce((a, b) => a + b.byteLength, 0);
    if (this.expectedSize >= 0 && total !== this.expectedSize) {
      this.ev.onError?.(
        `Size mismatch: got ${total} bytes, expected ${this.expectedSize}`,
      );
      return;
    }
    const blob = new Blob(this.parts as BlobPart[], {
      type: this.meta?.mime || "application/octet-stream",
    });
    this.ev.onDone?.(blob);
  }

  cancel() {
    this.dc?.close();
    this.pc.close();
  }
}

/* ---------- misc ---------- */

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}
