/**
 * Simulates the exact path the camera scanner takes:
 *   encrypt → chunkPayload → encode QR string → render QR PNG via qrcode →
 *   decode QR PNG via jsQR → decodeFrame → reassemble → decrypt
 *
 * If this passes, the protocol is correct and any live-app failure is
 * purely a rendering/scanning/UX issue (QR too dense, too small, etc).
 */

import QRCode from "qrcode";
import jsQR from "jsqr";
import { createCanvas } from "canvas";
import * as crypto from "node:crypto";

// Polyfill Web Crypto API for the Aegis crypto module
const webcrypto = crypto.webcrypto;
globalThis.crypto = webcrypto;
globalThis.crypto.subtle = webcrypto.subtle;

// Import the Aegis modules (.ts imports work in bun)
const cryptoLib = await import("/home/z/my-project/src/lib/crypto.ts");
const { deriveKeyFromPassphrase, encryptCombined, decryptCombined, generateAutoKey,
       bytesToB64, b64ToBytes, strToBytes, bytesToStr, keyFromRaw } = cryptoLib;
const qrLib = await import("/home/z/my-project/src/lib/qr-protocol.ts");
const { chunkPayload, encodeFrame, decodeFrame, reassemble, verifyHash } = qrLib;
const payLib = await import("/home/z/my-project/src/lib/payload.ts");
const { textToEnvelope, envelopeToJson, envelopeFromJson } = payLib;
const brandLib = await import("/home/z/my-project/src/lib/brand.ts");
const { PROTOCOL } = brandLib;

console.log(`\n=== Configuration ===`);
console.log(`  chunkBytes: ${PROTOCOL.chunkBytes}`);
console.log(`  pbkdf2Iterations: ${PROTOCOL.pbkdf2Iterations}`);
console.log(`  magic: "${PROTOCOL.magic}"`);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  + ${name}${extra ? "  " + extra : ""}`); }
  else { fail++; console.log(`  x ${name}${extra ? "  " + extra : ""}`); }
}

async function simulateScan(plaintext, opts) {
  opts = opts || {};
  const env = textToEnvelope(plaintext);
  const envJson = envelopeToJson(env);

  let key, rawKeyB64, saltB64;
  if (opts.usePassphrase && opts.passphrase) {
    const derived = await deriveKeyFromPassphrase(opts.passphrase);
    key = derived.key;
    saltB64 = bytesToB64(derived.salt);
  } else {
    key = await generateAutoKey();
    rawKeyB64 = key.raw;
  }

  const combined = await encryptCombined(key, strToBytes(envJson));
  const combinedB64 = bytesToB64(combined);
  const sessionId = Math.random().toString(36).slice(2, 8);
  const chunked = await chunkPayload(combinedB64, sessionId);

  const keyFrame = rawKeyB64
    ? encodeFrame({ m: "K", o: "auto", k: rawKeyB64 })
    : encodeFrame({ m: "K", o: "passphrase", k: "", s: saltB64 });

  const allFrameStrings = [keyFrame, ...chunked.frames];
  const decodedByScanner = [];

  for (let i = 0; i < allFrameStrings.length; i++) {
    const frameStr = allFrameStrings[i];
    const canvas = createCanvas(480, 480);
    await QRCode.toCanvas(canvas, frameStr, {
      errorCorrectionLevel: "Q",
      margin: 2,
      width: 480,
      color: { dark: "#0a0f0e", light: "#ffffff" },
    });
    const ctx = canvas.getContext("2d");
    const imgData = ctx.getImageData(0, 0, 480, 480);
    const code = jsQR(imgData.data, 480, 480, { inversionAttempts: "dontInvert" });
    if (code && code.data) {
      decodedByScanner.push(code.data);
    } else {
      const code2 = jsQR(imgData.data, 480, 480, { inversionAttempts: "attemptBoth" });
      if (code2 && code2.data) decodedByScanner.push(code2.data);
      else throw new Error(`Frame ${i} (${frameStr.length} chars) failed to decode via jsQR at 480px`);
    }
  }
  return { decodedByScanner, chunked };
}

async function simulateReceiveAndDecrypt(decodedFrames, opts) {
  opts = opts || {};
  let rawKeyB64, saltB64, keyOrigin;
  const chunks = new Map();
  let expectedTotal = 0, expectedHash = "", sessionId = "";

  for (const raw of decodedFrames) {
    const frame = decodeFrame(raw);
    if (!frame) throw new Error("decodeFrame returned null");
    if (frame.m === "K") {
      if (frame.o === "auto") { rawKeyB64 = frame.k; keyOrigin = "auto"; }
      else if (frame.o === "passphrase" && frame.s) { saltB64 = frame.s; keyOrigin = "passphrase"; }
    } else if (frame.m === "D") {
      if (!sessionId) {
        sessionId = frame.s;
        expectedTotal = frame.n;
        expectedHash = frame.h;
      }
      if (frame.s !== sessionId) throw new Error(`session mismatch`);
      if (!chunks.has(frame.i)) chunks.set(frame.i, b64ToBytes(frame.d));
    }
  }

  if (chunks.size < expectedTotal) throw new Error(`incomplete: ${chunks.size}/${expectedTotal}`);
  const result = reassemble(sessionId, chunks, expectedTotal, expectedHash);
  if (!result.ok) throw new Error(`reassemble failed`);
  const ok = await verifyHash(result.ciphertext, result.hashHex);
  if (!ok) throw new Error("hash mismatch");

  let rawKey = rawKeyB64;
  const origin = keyOrigin || "auto";
  if (origin === "passphrase" && opts.passphrase && saltB64) {
    const salt = b64ToBytes(saltB64);
    const { key } = await deriveKeyFromPassphrase(opts.passphrase, salt);
    rawKey = key.raw;
  }
  if (!rawKey) throw new Error("no raw key");
  const key = await keyFromRaw(rawKey, origin);
  const plaintext = await decryptCombined(key, result.ciphertext);
  const envJson = bytesToStr(plaintext);
  const env = envelopeFromJson(envJson);
  return env.b64 ? bytesToStr(b64ToBytes(env.b64)) : "";
}

console.log(`\n[Test 1] Round-trip: short text, auto key`);
{
  const msg = "Hello from Aegis Share - testing QR transfer";
  const { decodedByScanner } = await simulateScan(msg);
  const result = await simulateReceiveAndDecrypt(decodedByScanner);
  check("decode count matches frames", decodedByScanner.length === 2, `(${decodedByScanner.length} frames)`);
  check("decrypted text matches", result === msg);
}

console.log(`\n[Test 2] Round-trip: short text, passphrase`);
{
  const msg = "Passphrase mode round-trip";
  const { decodedByScanner } = await simulateScan(msg, { usePassphrase: true, passphrase: "secret123" });
  const result = await simulateReceiveAndDecrypt(decodedByScanner, { passphrase: "secret123" });
  check("decrypted with passphrase", result === msg);
}

console.log(`\n[Test 3] Round-trip: 100-byte text`);
{
  const msg = "X".repeat(100);
  const { decodedByScanner } = await simulateScan(msg);
  const result = await simulateReceiveAndDecrypt(decodedByScanner);
  check("decrypted 100-byte text matches", result === msg);
}

console.log(`\n[Test 4] Round-trip: 1KB text`);
{
  const msg = "This is a longer message ".repeat(50);
  const { decodedByScanner, chunked } = await simulateScan(msg);
  const result = await simulateReceiveAndDecrypt(decodedByScanner);
  check("decrypted 1KB text matches", result === msg, `(${decodedByScanner.length} frames, ${chunked.totalChunks} chunks)`);
}

console.log(`\n[Test 5] QR decode at sizes (240 / 320 / 400 / 480 / 640)`);
{
  const msg = "Size test payload";
  const env = textToEnvelope(msg);
  const envJson = envelopeToJson(env);
  const key = await generateAutoKey();
  const combined = await encryptCombined(key, strToBytes(envJson));
  const combinedB64 = bytesToB64(combined);
  const chunked = await chunkPayload(combinedB64, "abc123");
  const frameStr = chunked.frames[0];
  for (const size of [240, 320, 400, 480, 640]) {
    const canvas = createCanvas(size, size);
    await QRCode.toCanvas(canvas, frameStr, {
      errorCorrectionLevel: "Q",
      margin: 2,
      width: size,
      color: { dark: "#0a0f0e", light: "#ffffff" },
    });
    const ctx = canvas.getContext("2d");
    const imgData = ctx.getImageData(0, 0, size, size);
    const code = jsQR(imgData.data, size, size, { inversionAttempts: "dontInvert" });
    check(`jsQR decodes at ${size}px`, !!code && code.data === frameStr);
  }
}

console.log(`\n[Test 6] Frame size for current 850B chunks`);
{
  const msg = "Y".repeat(900);
  const env = textToEnvelope(msg);
  const envJson = envelopeToJson(env);
  const key = await generateAutoKey();
  const combined = await encryptCombined(key, strToBytes(envJson));
  const combinedB64 = bytesToB64(combined);
  const chunked = await chunkPayload(combinedB64, "abc123");
  console.log(`  total chunks: ${chunked.totalChunks}`);
  console.log(`  first data frame: ${chunked.frames[0].length} chars`);
  console.log(`  second data frame (if exists): ${chunked.frames[1]?.length || "n/a"} chars`);
}

console.log(`\n============================`);
console.log(`Pass: ${pass}  Fail: ${fail}`);
if (fail > 0) process.exit(1);
