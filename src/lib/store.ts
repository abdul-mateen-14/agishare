/**
 * COREX client state — Zustand store.
 * Holds everything the sender/receiver needs in memory. No persistence,
 * no servers: state lives only for the current browser session.
 */

import { create } from "zustand";

export type SendStatus = "idle" | "ready" | "broadcasting" | "done";

export type SendState = {
  status: SendStatus;
  /** The pre-encoded KEY frame string (or null in passphrase mode). */
  keyFrame: string | null;
  /** Pre-encoded DATA frame strings, in order. */
  dataFrames: string[];
  sessionId: string;
  hashHex: string;
  totalChunks: number;
  /** Current frame index the sender is showing. */
  cursor: number;
  /** ms per QR frame. */
  frameMs: number;
  /** Loop counter — how many full sweeps of all frames have been broadcast. */
  loops: number;
  /** The original plaintext (for the demo "echo" panel only — never travels over the air). */
  previewText: string;
  /** Original filename when sending a file. */
  fileName: string | null;
  /** Original mime when sending a file. */
  fileMime: string | null;
  /** Key origin label. */
  keyOrigin: "passphrase" | "auto";
  /** base64 raw key (auto mode) — shown as Key QR. */
  rawKeyB64: string | null;

  setSend: (patch: Partial<SendState>) => void;
  reset: () => void;
};

const initial: Omit<SendState, "setSend" | "reset"> = {
  status: "idle",
  keyFrame: null,
  dataFrames: [],
  sessionId: "",
  hashHex: "",
  totalChunks: 0,
  cursor: 0,
  frameMs: 220,
  loops: 0,
  previewText: "",
  fileName: null,
  fileMime: null,
  keyOrigin: "auto",
  rawKeyB64: null,
};

export const useCorexStore = create<SendState>((set) => ({
  ...initial,
  setSend: (patch) => set(patch),
  reset: () => set({ ...initial }),
}));

/* ----------------- Receiver ----------------- */

export type ReceiveStatus =
  | "idle"
  | "awaiting_key"
  | "scanning"
  | "complete"
  | "decrypted";

export type ChunkMap = Map<number, Uint8Array>;

export type ReceiveState = {
  status: ReceiveStatus;
  /** True if we are using a passphrase (receiver types it). */
  usingPassphrase: boolean;
  /** The raw key, once known (either from Key QR or derived from passphrase). */
  rawKeyB64: string | null;
  /** PBKDF2 salt, captured from Key QR in passphrase mode. */
  saltB64: string | null;
  /** Key origin — informs how we use the salt. */
  keyOrigin: "passphrase" | "auto" | null;

  /** Detected session id from incoming DATA frames. */
  sessionId: string | null;
  /** Expected total chunks. */
  expectedTotal: number;
  /** Expected hash. */
  expectedHash: string;
  /** Accumulated chunks keyed by index. */
  chunks: ChunkMap;
  /** Decrypted output, base64 of original file bytes (or text). */
  decryptedB64: string | null;
  /** Plaintext if it was a text transfer. */
  decryptedText: string | null;
  /** Filename captured from the payload header. */
  fileName: string | null;
  /** Mime captured from the payload header. */
  fileMime: string | null;
  /** Last error message. */
  error: string | null;

  setReceive: (patch: Partial<ReceiveState>) => void;
  reset: () => void;
};

const initialReceive: Omit<ReceiveState, "setReceive" | "reset"> = {
  status: "idle",
  usingPassphrase: false,
  rawKeyB64: null,
  saltB64: null,
  keyOrigin: null,
  sessionId: null,
  expectedTotal: 0,
  expectedHash: "",
  chunks: new Map(),
  decryptedB64: null,
  decryptedText: null,
  fileName: null,
  fileMime: null,
  error: null,
};

export const useReceiveStore = create<ReceiveState>((set) => ({
  ...initialReceive,
  setReceive: (patch) => set(patch),
  reset: () => set({ ...initialReceive }),
}));
