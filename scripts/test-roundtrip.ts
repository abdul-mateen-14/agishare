/**
 * End-to-end round-trip test for the COREX crypto + protocol stack.
 * Run with: bun run scripts/test-roundtrip.ts
 *
 * Verifies:
 *   1. Auto-key mode: encrypt → chunk → simulate QR frames → decode → reassemble → decrypt
 *   2. Passphrase mode: derive key with PBKDF2 → encrypt → chunk → decode → reassemble → decrypt
 *   3. Wrong passphrase fails to decrypt (auth tag verification)
 *   4. Non-COREX QR strings are ignored
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
  chunkPayload,
  decodeFrame,
  reassemble,
  verifyHash,
  encodeFrame,
  type DataFrame,
  type KeyFrame,
} from "../src/lib/qr-protocol";
import {
  textToEnvelope,
  envelopeToJson,
  envelopeFromJson,
  envelopeToBlob,
} from "../src/lib/payload";

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

async function testAutoKey() {
  console.log("\n[Test 1] Auto-key round-trip - small text");
  const text = "Hello COREX - this is a secret test message!";
  const env = textToEnvelope(text);
  const envJson = envelopeToJson(env);
  const envBytes = strToBytes(envJson);

  const key = await generateAutoKey();
  assert(key.origin === "auto", "key origin is 'auto'");
  assert(key.raw.length > 0, "raw key is base64-encoded");

  const combined = await encryptCombined(key, envBytes);
  assert(combined.length > 12 + 16, "combined blob has iv + ct + authTag");
  const combinedB64 = bytesToB64(combined);

  const sessionId = "ABC123";
  const chunked = await chunkPayload(combinedB64, sessionId);
  assert(chunked.totalChunks === chunked.frames.length, "frame count matches");
  console.log(`    payload ${combined.length}B -> ${chunked.totalChunks} frame(s)`);

  const receivedChunks = new Map<number, Uint8Array>();
  let receivedSession: string | null = null;
  let receivedTotal = 0;
  let receivedHash = "";
  for (const f of chunked.frames) {
    const decoded = decodeFrame(f);
    assert(decoded !== null, "frame decodes");
    if (decoded && decoded.m === "D") {
      const df = decoded as DataFrame;
      receivedSession = df.s;
      receivedTotal = df.n;
      receivedHash = df.h;
      receivedChunks.set(df.i, b64ToBytes(df.d));
    }
  }
  assert(receivedSession === sessionId, "session id matches");
  assert(receivedTotal === chunked.totalChunks, "total chunks match");

  const result = reassemble(receivedSession!, receivedChunks, receivedTotal, receivedHash);
  assert(result.ok, "reassembly succeeds");
  if (!result.ok) return;
  const ok = await verifyHash(result.ciphertext, result.hashHex);
  assert(ok, "hash check passes");

  const keyFrame: KeyFrame = { m: "K", o: "auto", k: key.raw };
  const keyFrameStr = encodeFrame(keyFrame);
  const decodedKeyFrame = decodeFrame(keyFrameStr);
  assert(decodedKeyFrame !== null && decodedKeyFrame.m === "K", "key frame decodes");
  if (decodedKeyFrame && decodedKeyFrame.m === "K") {
    const kf = decodedKeyFrame as KeyFrame;
    const receiverKey = await keyFromRaw(kf.k, "auto");
    const plaintext = await decryptCombined(receiverKey, result.ciphertext);
    const ptJson = bytesToStr(plaintext);
    const ptEnv = envelopeFromJson(ptJson);
    assert(ptEnv.kind === "text", "decrypted envelope is text kind");
    const { text: ptText } = envelopeToBlob(ptEnv);
    assert(ptText === text, "decrypted text matches original");
    console.log(`    decrypted: "${ptText}"`);
  }
}

async function testPassphrase() {
  console.log("\n[Test 2] Passphrase round-trip - larger text");
  const text = "The quick brown fox jumps over the lazy dog. ".repeat(50);
  const env = textToEnvelope(text);
  const envJson = envelopeToJson(env);
  const envBytes = strToBytes(envJson);

  const salt = new Uint8Array(16);
  for (let i = 0; i < 16; i++) salt[i] = i;
  const pp = "correct horse battery staple";
  const { key, salt: derivedSalt } = await deriveKeyFromPassphrase(pp, salt);
  assert(derivedSalt.length === 16, "salt is 16 bytes");

  const combined = await encryptCombined(key, envBytes);
  const combinedB64 = bytesToB64(combined);
  const chunked = await chunkPayload(combinedB64, "XYZ789");
  console.log(`    payload ${combined.length}B -> ${chunked.totalChunks} frame(s)`);
  assert(chunked.totalChunks > 1, "large text produces multiple chunks");

  const keyFrame: KeyFrame = { m: "K", o: "passphrase", k: "", s: bytesToB64(salt) };
  const keyFrameStr = encodeFrame(keyFrame);
  const decodedKeyFrame = decodeFrame(keyFrameStr);
  if (!decodedKeyFrame || decodedKeyFrame.m !== "K") {
    assert(false, "key frame decodes");
    return;
  }
  const kf = decodedKeyFrame as KeyFrame;
  assert(kf.s !== undefined, "salt captured from key frame");

  const recvSalt = b64ToBytes(kf.s!);
  const { key: recvKey } = await deriveKeyFromPassphrase(pp, recvSalt);
  assert(recvKey.raw === key.raw, "derived key matches sender's key");

  const receivedChunks = new Map<number, Uint8Array>();
  let receivedTotal = 0;
  let receivedHash = "";
  for (const f of chunked.frames) {
    const decoded = decodeFrame(f);
    if (decoded && decoded.m === "D") {
      const df = decoded as DataFrame;
      receivedTotal = df.n;
      receivedHash = df.h;
      receivedChunks.set(df.i, b64ToBytes(df.d));
    }
  }
  const result = reassemble("XYZ789", receivedChunks, receivedTotal, receivedHash);
  assert(result.ok, "reassembly succeeds");
  if (!result.ok) return;
  const ok = await verifyHash(result.ciphertext, result.hashHex);
  assert(ok, "hash check passes");

  const plaintext = await decryptCombined(recvKey, result.ciphertext);
  const ptEnv = envelopeFromJson(bytesToStr(plaintext));
  const { text: ptText } = envelopeToBlob(ptEnv);
  assert(ptText === text, "decrypted text matches original");
  console.log(`    decrypted length: ${ptText.length} chars`);
}

async function testWrongPassphrase() {
  console.log("\n[Test 3] Wrong passphrase fails decryption (auth tag check)");
  const text = "secret";
  const env = textToEnvelope(text);
  const envBytes = strToBytes(envelopeToJson(env));

  const salt = new Uint8Array(16);
  for (let i = 0; i < 16; i++) salt[i] = i + 1;
  const { key } = await deriveKeyFromPassphrase("right passphrase", salt);
  const combined = await encryptCombined(key, envBytes);

  const { key: wrongKey } = await deriveKeyFromPassphrase("wrong passphrase", salt);
  let threw = false;
  try {
    await decryptCombined(wrongKey, combined);
  } catch (e) {
    threw = true;
    console.log(`    decrypt threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  assert(threw, "decryption with wrong key throws");
}

async function testNonCorexFrame() {
  console.log("\n[Test 4] Non-COREX QR is ignored by decoder");
  const r = decodeFrame("https://example.com/some/other/qr");
  assert(r === null, "non-COREX string returns null");
  const r2 = decodeFrame("COREX1not-json-at-all-{}{");
  assert(r2 === null, "malformed JSON returns null");
  const r3 = decodeFrame('COREX1{"m":"X"}');
  assert(r3 === null, "unknown frame type returns null");
}

async function main() {
  console.log("COREX round-trip test");
  console.log("=====================");
  await testAutoKey();
  await testPassphrase();
  await testWrongPassphrase();
  await testNonCorexFrame();
  console.log(`\n=====================`);
  console.log(`Pass: ${pass}  Fail: ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
