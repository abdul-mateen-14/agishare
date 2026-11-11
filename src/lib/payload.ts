/**
 * Helpers for wrapping user content (text or file) into a single payload
 * envelope that travels inside the encrypted ciphertext.
 *
 * Envelope (UTF-8 JSON, then encrypted):
 *   { kind: "text" | "file", name?: string, mime?: string, b64: <base64 of raw bytes> }
 *
 * For text we still base64-encode UTF-8 bytes so the envelope shape is uniform.
 */

export type PayloadEnvelope = {
  kind: "text" | "file";
  name?: string;
  mime?: string;
  b64: string;
};

export function envelopeToJson(env: PayloadEnvelope): string {
  return JSON.stringify(env);
}

export function envelopeFromJson(json: string): PayloadEnvelope {
  const obj = JSON.parse(json);
  if (obj.kind !== "text" && obj.kind !== "file") {
    throw new Error("unknown envelope kind");
  }
  return obj as PayloadEnvelope;
}

export function textToEnvelope(text: string): PayloadEnvelope {
  // base64 of UTF-8 bytes
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return { kind: "text", b64: btoa(s) };
}

export function fileToEnvelope(file: File): Promise<PayloadEnvelope> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(buf);
      let s = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode.apply(
          null,
          // @ts-expect-error - apply accepts array-like
          bytes.subarray(i, i + CHUNK),
        );
      }
      resolve({
        kind: "file",
        name: file.name,
        mime: file.type || "application/octet-stream",
        b64: btoa(s),
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export function envelopeToBlob(env: PayloadEnvelope): {
  blob: Blob;
  isText: boolean;
  text: string;
} {
  const s = atob(env.b64);
  const len = s.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = s.charCodeAt(i);
  if (env.kind === "text") {
    return {
      blob: new Blob([bytes as BlobPart], { type: "text/plain;charset=utf-8" }),
      isText: true,
      text: new TextDecoder().decode(bytes),
    };
  }
  return {
    blob: new Blob([bytes as BlobPart], {
      type: env.mime || "application/octet-stream",
    }),
    isText: false,
    text: "",
  };
}
