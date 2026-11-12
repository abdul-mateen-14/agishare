/**
 * End-to-end round-trip test for Aegis Share crypto + protocol stack.
 * Run with: bun run scripts/test-roundtrip.ts
 */

import {
  deriveKeyFromPassphrase,
  encryptCombined,
  decryptCombined,
  generateAutoKey,
  bytesToB64,
  b64ToBytes,
  strToBytes,
  bytesToStr,
  keyFromRaw,
} from "../src/lib/crypto";
import {
  encryptChunk,
  decryptChunk,
} from "../src/lib/file-crypto";
import {
  chunkPayload,
  decodeFrame,
  reassemble,
  verifyHash,
  encodeFrame,
  type DataFrame,
  type KeyFrame,
  type SignalFrame,
} from "../src/lib/qr-protocol";
import {
  textToEnvelope,
  envelopeToJson,
  envelopeFromJson,
  envelopeToBlob,
} from "../src/lib/payload";
import {
  buildLink,
  parseLink,
} from "../src/lib/link-transfer";
import {
  ivForChunk,
  packChunkMessage,
  unpackChunkMessage,
  packMeta,
  unpackMeta,
  makeFileMeta,
} from "../src/lib/file-crypto";
import {
  makeSignalFrames,
  encodeSignalFrames,
  parseCopyPasteCode,
  makeCopyPasteCode,
  SignalAccumulator,
  newSessionId,
  type SignalingPayload,
} from "../src/lib/webrtc-signaling";
import { PROTOCOL } from "../src/lib/brand";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log(`  + ${msg}`);
  } else {
    fail++;
    console.error(`  X ${msg}`);
  }
}

async function testQrAutoKey() {
  console.log("\n[Test 1] QR auto-key round-trip");
  const text = "Hello Aegis - secret test message!";
  const env = textToEnvelope(text);
  const key = await generateAutoKey();
  const combined = await encryptCombined(key, strToBytes(envelopeToJson(env)));
  const chunked = await chunkPayload(bytesToB64(combined), "ABC123");
  assert(chunked.frames.length === chunked.totalChunks, "frame count matches");

  const chunks = new Map<number, Uint8Array>();
  let total = 0, hash = "";
  for (const f of chunked.frames) {
    const d = decodeFrame(f);
    assert(d !== null, "frame decodes with AEGIS1 magic");
    if (d && d.m === "D") {
      const df = d as DataFrame;
      total = df.n; hash = df.h;
      chunks.set(df.i, b64ToBytes(df.d));
    }
  }
  const r = reassemble("ABC123", chunks, total, hash);
  assert(r.ok, "reassembly ok");
  if (!r.ok) return;
  assert(await verifyHash(r.ciphertext, hash), "hash verified");
  const kf: KeyFrame = { m: "K", o: "auto", k: key.raw };
  const dk = decodeFrame(encodeFrame(kf));
  if (dk && dk.m === "K") {
    const rk = await keyFromRaw((dk as KeyFrame).k, "auto");
    const pt = await decryptCombined(rk, r.ciphertext);
    const out = envelopeFromJson(bytesToStr(pt));
    const { text: t } = envelopeToBlob(out);
    assert(t === text, "decrypted text matches");
  }
}

async function testQrPassphrase() {
  console.log("\n[Test 2] QR passphrase round-trip (multi-chunk)");
  const text = "The quick brown fox. ".repeat(80);
  const salt = new Uint8Array(16).map((_, i) => i);
  const { key } = await deriveKeyFromPassphrase("correct horse", salt);
  const combined = await encryptCombined(key, strToBytes(envelopeToJson(textToEnvelope(text))));
  const chunked = await chunkPayload(bytesToB64(combined), "XYZ789");
  assert(chunked.totalChunks > 1, "multi-chunk");

  // Key frame carries salt
  const kfStr = encodeFrame({ m: "K", o: "passphrase", k: "", s: bytesToB64(salt) } as KeyFrame);
  const dk = decodeFrame(kfStr);
  assert(dk !== null && dk.m === "K", "key frame decodes");
  const recvSalt = b64ToBytes(((dk as KeyFrame).s) ?? "");
  const { key: rk } = await deriveKeyFromPassphrase("correct horse", recvSalt);
  assert(rk.raw === key.raw, "receiver derives identical key");

  const chunks = new Map<number, Uint8Array>();
  let total = 0, hash = "";
  for (const f of chunked.frames) {
    const d = decodeFrame(f);
    if (d && d.m === "D") {
      total = (d as DataFrame).n; hash = (d as DataFrame).h;
      chunks.set((d as DataFrame).i, b64ToBytes((d as DataFrame).d));
    }
  }
  const r = reassemble("XYZ789", chunks, total, hash);
  assert(r.ok, "reassembly ok");
  if (!r.ok) return;
  const pt = await decryptCombined(rk, r.ciphertext);
  const { text: t } = envelopeToBlob(envelopeFromJson(bytesToStr(pt)));
  assert(t === text, "decrypted text matches");
}

async function testLinkMode() {
  console.log("\n[Test 3] Link mode round-trip (auto + passphrase)");
  // auto
  const text = "link secret payload";
  const autoKey = await generateAutoKey();
  const combined = await encryptCombined(autoKey, strToBytes(envelopeToJson(textToEnvelope(text))));
  const dataB64 = bytesToB64(combined);
  const url = buildLink("https://aegishare.app", "auto", bytesToB64(new Uint8Array(16)), autoKey.raw, dataB64);
  assert(url.includes("#a1.a."), "auto link format");
  const p = parseLink(url.slice(url.indexOf("#")));
  assert(p !== null, "auto link parses");
  if (!p) return;
  assert(p.keyOrigin === "auto" && p.key === autoKey.raw, "auto key embedded");
  const km = await keyFromRaw(p.key!, "auto");
  const pt = await decryptCombined(km, b64ToBytes(p.data));
  assert(bytesToStr(pt) === envelopeToJson(textToEnvelope(text)), "auto decrypt matches");

  // passphrase
  const salt = new Uint8Array(16).map((_, i) => i + 3);
  const { key } = await deriveKeyFromPassphrase("shared secret", salt);
  const combined2 = await encryptCombined(key, strToBytes(envelopeToJson(textToEnvelope(text))));
  const url2 = buildLink("https://aegishare.app", "passphrase", bytesToB64(salt), null, bytesToB64(combined2));
  const p2 = parseLink(url2.slice(url2.indexOf("#")));
  assert(p2 !== null && p2.keyOrigin === "passphrase" && p2.key === null, "passphrase link has no key");
  const { key: rk } = await deriveKeyFromPassphrase("shared secret", b64ToBytes(p2.salt));
  const pt2 = await decryptCombined(rk, b64ToBytes(p2.data));
  assert(bytesToStr(pt2) === envelopeToJson(textToEnvelope(text)), "passphrase decrypt matches");

  // negative
  assert(parseLink("https://example.com/#nothing") === null, "foreign hash rejected");
}

async function testFileCrypto() {
  console.log("\n[Test 4] File crypto chunk round-trip (wire format)");
  const sessionId = newSessionId();
  assert(sessionId.length === 8, "session id 8 chars");

  const meta = makeFileMeta(
    { name: "test.bin", size: 150_000, type: "application/octet-stream" } as File,
    sessionId,
    "passphrase",
    bytesToB64(new Uint8Array(16)),
  );
  assert(meta.totalChunks === Math.ceil(150_000 / PROTOCOL.streamChunkBytes), "totalChunks math");

  // meta wire round-trip
  const metaB64 = packMeta(meta);
  const metaOut = unpackMeta(metaB64);
  assert(metaOut.name === "test.bin" && metaOut.size === 150_000 && metaOut.id === sessionId, "meta pack/unpack");

  const salt = new Uint8Array(16).map((_, i) => i + 1);
  const { key } = await deriveKeyFromPassphrase("file pp", salt);
  const data = new Uint8Array(150_000).map((_, i) => (i * 7) % 256);

  // encrypt all chunks, pack wire messages, unpack + decrypt
  const received = new Map<number, Uint8Array>();
  const nChunks = meta.totalChunks;
  for (let i = 0; i < nChunks; i++) {
    const slice = data.subarray(i * meta.chunkSize, Math.min((i + 1) * meta.chunkSize, data.length));
    const ct = await encryptChunk(key.handle, sessionId, i, slice);
    const msg = packChunkMessage(i, ct);
    const { chunkIndex, ct: ctOut } = unpackChunkMessage(msg);
    assert(chunkIndex === i, `wire chunk index ${i}`);
    const pt = await decryptChunk(key.handle, sessionId, chunkIndex, ctOut);
    received.set(chunkIndex, pt);
  }
  // verify all bytes
  let ok = true;
  for (let i = 0; i < data.length; i++) {
    const ci = Math.floor(i / meta.chunkSize);
    const off = i % meta.chunkSize;
    if (received.get(ci)![off] !== data[i]) { ok = false; break; }
  }
  assert(ok, "all decrypted bytes match original");
  assert(ivForChunk(sessionId, 0).length === 12, "IV is 12 bytes");
  const iv0 = ivForChunk(sessionId, 0);
  const iv1 = ivForChunk(sessionId, 1);
  assert(iv0[8] === 0 && iv1[8] === 1, "IV encodes chunk index");
}

async function testSignaling() {
  console.log("\n[Test 5] P2P signaling round-trip (QR frames + copy-paste)");
  const payload: SignalingPayload = {
    role: "offer",
    id: newSessionId(),
    sdp: "v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\n...".repeat(40), // ~2.8KB
    meta: {
      id: "sess0001", name: "movie.mkv", size: 4_000_000_000, mime: "video/x-matroska",
      chunkSize: PROTOCOL.streamChunkBytes, totalChunks: Math.ceil(4e9 / PROTOCOL.streamChunkBytes),
      salt: bytesToB64(new Uint8Array(16)), keyOrigin: "passphrase",
    },
  };

  // QR path
  const frames = makeSignalFrames(payload);
  assert(frames.length > 1, "offer chunked into multiple QR frames");
  const encoded = encodeSignalFrames(frames);
  const acc = new SignalAccumulator();
  let assembled: SignalingPayload | null = null;
  for (const e of encoded) {
    const d = decodeFrame(e);
    assert(d !== null && d.m === "S", "signal frame decodes");
    if (d && d.m === "S") assembled = acc.push(d as SignalFrame);
  }
  assert(assembled !== null, "accumulator assembles offer");
  if (!assembled) return;
  assert(assembled.sdp === payload.sdp, "SDP identical");
  assert(assembled.meta?.name === "movie.mkv", "meta survives");

  // copy-paste path
  const code = makeCopyPasteCode(payload);
  assert(code.startsWith("A1S."), "copy-paste code prefix");
  const p2 = parseCopyPasteCode(code);
  assert(p2 !== null && p2.sdp === payload.sdp && p2.role === "offer", "copy-paste round-trip");

  // answer path
  const answer: SignalingPayload = { role: "answer", id: payload.id, sdp: "v=0 answer..." };
  const ansCode = makeCopyPasteCode(answer);
  const p3 = parseCopyPasteCode(ansCode);
  assert(p3 !== null && p3.role === "answer", "answer code round-trip");

  // garbage rejected
  assert(parseCopyPasteCode("https://example.com") === null, "foreign code rejected");
  assert(decodeFrame("hello world") === null, "foreign QR rejected");
}

async function testWrongKey() {
  console.log("\n[Test 6] Wrong passphrase fails (GCM auth)");
  const salt = new Uint8Array(16);
  const { key } = await deriveKeyFromPassphrase("right", salt);
  const ct = await encryptCombined(key, strToBytes("secret"));
  const { key: wrong } = await deriveKeyFromPassphrase("wrong", salt);
  let threw = false;
  try { await decryptCombined(wrong, ct); } catch { threw = true; }
  assert(threw, "wrong key throws");
}

async function testBooster() {
  console.log("\n[Test 7] Download Booster helpers");
  const { isProbablyPublicUrl, guessFilename } = await import("../src/lib/booster");
  assert(isProbablyPublicUrl("https://example.com/x.zip").ok, "https ok");
  assert(isProbablyPublicUrl("http://example.com").ok, "http ok");
  assert(!isProbablyPublicUrl("file:///etc/passwd").ok, "file:// rejected");
  assert(!isProbablyPublicUrl("not a url").ok, "garbage rejected");
  assert(!isProbablyPublicUrl("ftp://example.com").ok, "ftp rejected");

  // filename guessing
  assert(guessFilename("https://github.com/x/y/releases/download/v1/file.zip") === "file.zip",
    "filename from path");
  assert(guessFilename("https://example.com/") !== "", "fallback filename non-empty");
  assert(guessFilename("https://example.com/path/file%20name.bin") === "file name.bin",
    "filename url-decoded");
}

async function main() {
  console.log("Aegis Share round-trip tests");
  console.log("============================");
  await testQrAutoKey();
  await testQrPassphrase();
  await testLinkMode();
  await testFileCrypto();
  await testSignaling();
  await testWrongKey();
  await testBooster();
  console.log("\n============================");
  console.log(`Pass: ${pass}  Fail: ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
