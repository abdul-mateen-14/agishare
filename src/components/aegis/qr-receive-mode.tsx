"use client";

import * as React from "react";
import { useReceiveStore } from "@/lib/store";
import {
  decryptCombined,
  keyFromRaw,
  deriveKeyFromPassphrase,
  b64ToBytes,
  bytesToB64,
} from "@/lib/crypto";
import {
  decodeFrame,
  reassemble,
  verifyHash,
  type DataFrame,
  type KeyFrame,
} from "@/lib/qr-protocol";
import { envelopeFromJson, envelopeToBlob } from "@/lib/payload";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Camera,
  CameraOff,
  KeyRound,
  CheckCircle2,
  Loader2,
  Download,
  Copy,
  Lock,
  RefreshCw,
} from "lucide-react";
import { useCameraScanner, type ScanResult } from "./use-camera-scanner";
import { toast } from "sonner";

export function QrReceivePanel() {
  const store = useReceiveStore();
  const {
    status,
    usingPassphrase,
    rawKeyB64,
    saltB64,
    keyOrigin,
    sessionId,
    expectedTotal,
    chunks,
    decryptedB64,
    decryptedText,
    fileName,
    fileMime,
    error,
    setReceive,
    reset,
  } = store;

  const [passphrase, setPassphrase] = React.useState("");
  const [pasteKey, setPasteKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Keep a ref to passphrase so the memoized scan callback (which captures
  // the first render's closure) can read the latest value at scan time.
  const passphraseRef = React.useRef("");
  React.useEffect(() => {
    passphraseRef.current = passphrase;
  }, [passphrase]);

  /* ----- scanning loop ----- */

  const handleScan = React.useCallback(async (r: ScanResult) => {
    const frame = decodeFrame(r.data);
    if (!frame) return; // ignore non-Aegis Share QR codes
    const s = useReceiveStore.getState();

    if (frame.m === "K") {
      // KEY frame
      const kf: KeyFrame = frame;
      if (kf.o === "auto" && kf.k) {
        // Auto mode: capture the raw key directly. We also pre-import the key
        // so it's ready when the time comes.
        try {
          await keyFromRaw(kf.k, "auto"); // throws on malformed
          useReceiveStore.setState({
            rawKeyB64: kf.k,
            saltB64: null,
            keyOrigin: "auto",
            usingPassphrase: false,
            status:
              s.status === "idle" || s.status === "awaiting_key"
                ? "scanning"
                : s.status,
          });
          toast.success("Key captured from Key QR. Now scan the data frames.");
          await maybeDecryptIfReady();
        } catch (e) {
          toast.error(`Bad key QR: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (kf.o === "passphrase" && kf.s) {
        useReceiveStore.setState({
          saltB64: kf.s,
          keyOrigin: "passphrase",
          usingPassphrase: true,
          status: "awaiting_key",
        });
        toast.info("Salt captured. Enter the passphrase, then start scanning.");
      }
      return;
    }

    // DATA frame
    const df: DataFrame = frame;
    let cur = useReceiveStore.getState();

    // Lock to a session, or adopt a new one if the sender restarted.
    if (!cur.sessionId) {
      useReceiveStore.setState({
        sessionId: df.s,
        expectedTotal: df.n,
        expectedHash: df.h,
      });
      cur = useReceiveStore.getState();
    } else if (cur.sessionId !== df.s) {
      // Different session — skip silently. We're locked to the first one
      // until the user resets.
      return;
    } else if (cur.expectedTotal !== df.n || cur.expectedHash !== df.h) {
      useReceiveStore.setState({
        expectedTotal: df.n,
        expectedHash: df.h,
        chunks: new Map(),
        decryptedB64: null,
        decryptedText: null,
        fileName: null,
        fileMime: null,
        error: null,
      });
      cur = useReceiveStore.getState();
    }

    // Store the chunk (idempotent)
    if (cur.chunks.has(df.i)) return;
    const chunkBytes = b64ToBytes(df.d);
    const newChunks = new Map(cur.chunks);
    newChunks.set(df.i, chunkBytes);
    useReceiveStore.setState({ chunks: newChunks, status: "scanning" });

    // Maybe complete?
    if (newChunks.size >= cur.expectedTotal) {
      await tryAssembleAndDecrypt(
        cur.sessionId ?? df.s,
        newChunks,
        cur.expectedTotal,
        cur.expectedHash,
      );
    }
  }, []);

  const { videoRef, canvasRef, start, stop, cameraState } = useCameraScanner(
    handleScan,
    (msg) => {
      useReceiveStore.setState({ error: msg });
      toast.error(msg);
    },
  );

  /* ----- assembly + decrypt ----- */

  // If we already have all chunks AND a key is available, (re-)attempt
  // decryption. Called after every key source becomes ready so the user
  // doesn't have to scan another frame just to trigger decryption.
  async function maybeDecryptIfReady() {
    const s = useReceiveStore.getState();
    if (!s.sessionId || s.expectedTotal === 0) return; // no session yet
    if (s.chunks.size < s.expectedTotal) return; // not complete
    const pp = passphraseRef.current;
    const hasKey =
      (!!s.rawKeyB64 && !s.usingPassphrase) ||
      (s.usingPassphrase && !!pp && !!s.saltB64);
    if (!hasKey) return;
    if (s.status === "decrypted") return; // already done
    await tryAssembleAndDecrypt(
      s.sessionId,
      s.chunks,
      s.expectedTotal,
      s.expectedHash,
    );
  }

  async function tryAssembleAndDecrypt(
    sid: string,
    chunkMap: Map<number, Uint8Array>,
    total: number,
    expectedHash: string,
  ) {
    const result = reassemble(sid, chunkMap, total, expectedHash);
    if (!result.ok) {
      useReceiveStore.setState({ error: "Reassembly failed" });
      return;
    }
    const ok = await verifyHash(result.ciphertext, result.hashHex);
    if (!ok) {
      useReceiveStore.setState({
        error: "Integrity check failed — keep scanning, some frames were garbled.",
      });
      return;
    }

    // We have valid combined bytes (iv || ct). Now we need a key to decrypt.
    const s = useReceiveStore.getState();
    useReceiveStore.setState({ status: "complete" });

    // Read passphrase from the ref so we always see the latest typed value.
    const pp = passphraseRef.current;
    if (!s.rawKeyB64 && !(s.usingPassphrase && pp && s.saltB64)) {
      useReceiveStore.setState({
        status: "awaiting_key",
        decryptedB64: null,
        error: "All frames received but no key yet. Scan the Key QR or enter the passphrase.",
      });
      toast.error("No key yet — scan the Key QR or enter the passphrase.");
      return;
    }

    setBusy(true);
    try {
      let rawKey = s.rawKeyB64;
      let origin: "passphrase" | "auto" = (s.keyOrigin as "passphrase" | "auto") ?? "auto";

      if (s.usingPassphrase && pp) {
        if (!s.saltB64) throw new Error("Missing salt — scan the Key QR first.");
        const salt = b64ToBytes(s.saltB64);
        const { key } = await deriveKeyFromPassphrase(pp, salt);
        rawKey = key.raw;
        origin = "passphrase";
      }
      if (!rawKey) throw new Error("No key available");
      const key = await keyFromRaw(rawKey, origin);

      const plaintext = await decryptCombined(key, result.ciphertext);
      const envJson = new TextDecoder().decode(plaintext);
      const env = envelopeFromJson(envJson);

      const { blob, isText, text } = envelopeToBlob(env);
      let textOut: string | null = null;
      let fileNameOut: string | null = null;
      let mimeOut: string | null = null;
      if (env.kind === "text") {
        textOut = text;
      } else {
        fileNameOut = env.name ?? "aegis.bin";
        mimeOut = env.mime ?? "application/octet-stream";
      }

      const envJsonB64 = bytesToB64(plaintext);
      useReceiveStore.setState({
        status: "decrypted",
        decryptedB64: envJsonB64,
        decryptedText: textOut,
        fileName: fileNameOut,
        fileMime: mimeOut,
        error: null,
      });
      toast.success("Decrypted successfully");
      void blob;
      void isText;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useReceiveStore.setState({
        status: "complete",
        error: `Decrypt failed: ${msg}`,
      });
      toast.error(`Decrypt failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  /* ----- key / passphrase handlers ----- */

  function handlePasteKey() {
    if (!pasteKey.trim()) return;
    useReceiveStore.setState({
      rawKeyB64: pasteKey.trim(),
      keyOrigin: "auto",
      usingPassphrase: false,
      saltB64: null,
      status: status === "awaiting_key" || status === "idle" ? "scanning" : status,
    });
    toast.success("Key loaded from paste. Start scanning.");
    // If chunks already arrived, try decrypting right away.
    void maybeDecryptIfReady();
  }

  function handlePassphraseReady() {
    if (passphrase.length < 4) return;
    if (!saltB64) {
      toast.error("Scan the sender's Key QR first to capture the salt.");
      return;
    }
    useReceiveStore.setState({ status: "scanning", keyOrigin: "passphrase" });
    // If chunks already arrived, try decrypting right away.
    void maybeDecryptIfReady();
  }

  async function downloadResult() {
    const s = useReceiveStore.getState();
    if (!s.decryptedB64) return;
    try {
      const envJson = atob(s.decryptedB64);
      const env = envelopeFromJson(envJson);
      const { blob } = envelopeToBlob(env);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = env.name ?? `aegis-${Date.now()}.${env.kind === "text" ? "txt" : "bin"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const have = chunks.size;
  const progress = expectedTotal ? (have / expectedTotal) * 100 : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
      {/* Left: camera */}
      <Card className="lg:w-[420px]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-mono uppercase tracking-wider">
            <Camera className="size-4" />
            Camera
          </CardTitle>
          <CardDescription className="text-[11px]">
            Aim at the sender&apos;s screen. We ignore non-Aegis Share QR codes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black ring-1 ring-border">
            <video
              ref={videoRef}
              className="size-full object-cover"
              muted
              playsInline
            />
            <canvas ref={canvasRef} className="hidden" />
            {/* HUD overlay */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`relative h-3/4 w-4/5 rounded-lg border-2 border-primary/70 ${
                  cameraState.kind === "running" ? "aegis-sweep" : ""
                }`}
                style={{
                  boxShadow:
                    cameraState.kind === "running"
                      ? "0 0 0 9999px rgba(0,0,0,0.35)"
                      : "0 0 0 9999px rgba(0,0,0,0.55)",
                }}
              >
                <span className="absolute -left-1 -top-1 size-4 border-l-2 border-t-2 border-primary" />
                <span className="absolute -right-1 -top-1 size-4 border-r-2 border-t-2 border-primary" />
                <span className="absolute -left-1 -bottom-1 size-4 border-l-2 border-b-2 border-primary" />
                <span className="absolute -right-1 -bottom-1 size-4 border-r-2 border-b-2 border-primary" />
              </div>
            </div>
            {/* idle / error overlay */}
            {cameraState.kind !== "running" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                {cameraState.kind === "error" ? (
                  <>
                    <CameraOff className="size-8 text-destructive" />
                    <p className="text-xs text-destructive max-w-[260px]">
                      {cameraState.message}
                    </p>
                    <Button size="sm" variant="outline" onClick={start}>
                      Try again
                    </Button>
                  </>
                ) : cameraState.kind === "starting" ? (
                  <>
                    <Loader2 className="size-8 animate-spin text-primary" />
                    <p className="text-xs text-muted-foreground">Starting camera…</p>
                  </>
                ) : (
                  <>
                    <Camera className="size-8 text-primary" />
                    <p className="text-xs text-muted-foreground">
                      Camera is off. Tap Start to begin scanning.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {cameraState.kind === "running" ? (
              <Button variant="outline" size="sm" onClick={stop} className="flex-1">
                <CameraOff className="size-3.5" /> Stop
              </Button>
            ) : (
              <Button size="sm" onClick={start} className="flex-1">
                <Camera className="size-3.5" /> Start scanning
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                stop();
                reset();
                setPassphrase("");
                setPasteKey("");
              }}
            >
              <RefreshCw className="size-3.5" /> Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Right: key + status + result */}
      <div className="space-y-4">
        {/* Key panel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-mono uppercase tracking-wider">
              <KeyRound className="size-4" />
              Key
            </CardTitle>
            <CardDescription className="text-[11px]">
              Either scan the sender&apos;s Key QR (auto mode) or enter the
              passphrase / paste the key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Passphrase mode</div>
                <p className="text-[11px] text-muted-foreground">
                  Toggle on if the sender used a passphrase. You&apos;ll still
                  need to scan the Key QR for the salt.
                </p>
              </div>
              <Switch
                checked={usingPassphrase}
                onCheckedChange={(v) => setReceive({ usingPassphrase: v })}
              />
            </div>

            {usingPassphrase ? (
              <div className="space-y-2">
                <Label htmlFor="pp" className="text-xs">
                  Passphrase
                </Label>
                <Input
                  id="pp"
                  type="text"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Type the passphrase the sender told you"
                  className="font-mono text-sm"
                  autoComplete="off"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePassphraseReady}
                  disabled={!passphrase || !saltB64}
                  className="w-full"
                >
                  {saltB64
                    ? "Set passphrase & start scanning"
                    : "Scan the Key QR first to capture salt"}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="pk" className="text-xs">
                  Or paste the auto key (base64)
                </Label>
                <Input
                  id="pk"
                  type="text"
                  value={pasteKey}
                  onChange={(e) => setPasteKey(e.target.value)}
                  placeholder="Paste the key the sender shared out-of-band"
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePasteKey}
                  disabled={!pasteKey.trim()}
                  className="w-full"
                >
                  <KeyRound className="size-3.5" /> Use this key
                </Button>
              </div>
            )}

            {/* Key status badges */}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={rawKeyB64 ? "default" : "secondary"} className="font-mono text-[10px]">
                {rawKeyB64
                  ? `key ✓ (${rawKeyB64.length > 16 ? rawKeyB64.slice(0, 14) + "…" : rawKeyB64})`
                  : "no key yet"}
              </Badge>
              <Badge variant={saltB64 ? "default" : "secondary"} className="font-mono text-[10px]">
                {saltB64 ? "salt ✓" : "no salt"}
              </Badge>
              <Badge variant={keyOrigin ? "default" : "secondary"} className="font-mono text-[10px]">
                {keyOrigin ?? "—"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Status / progress */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono uppercase tracking-wider">
              Progress
            </CardTitle>
            <CardDescription className="text-[11px]">
              {sessionId
                ? `session ${sessionId} — ${have}/${expectedTotal} frames`
                : "Waiting for first Aegis Share frame…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={progress} className="h-2" />
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Status" value={statusLabel(status)} />
              <Stat label="Have" value={`${have}`} />
              <Stat label="Total" value={`${expectedTotal || "—"}`} />
            </div>
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </div>
            )}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Decrypting…
              </div>
            )}
          </CardContent>
        </Card>

        {/* Result */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-mono uppercase tracking-wider">
              <Lock className="size-4" />
              Decrypted
            </CardTitle>
            <CardDescription className="text-[11px]">
              {decryptedText
                ? "Plaintext below — copy or save."
                : fileName
                ? "File ready to download."
                : "Nothing decrypted yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {decryptedText ? (
              <>
                <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-words">
                  {decryptedText}
                </pre>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard?.writeText(decryptedText);
                      toast.success("Copied to clipboard");
                    }}
                  >
                    <Copy className="size-3.5" /> Copy
                  </Button>
                  <Button size="sm" variant="ghost" onClick={downloadResult}>
                    <Download className="size-3.5" /> Save .txt
                  </Button>
                </div>
              </>
            ) : fileName ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                  <CheckCircle2 className="size-5 text-primary" />
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{fileName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {fileMime || "binary"}
                    </div>
                  </div>
                </div>
                <Button size="sm" onClick={downloadResult}>
                  <Download className="size-3.5" /> Download
                </Button>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
                Once enough frames are scanned and the key is set, your
                decrypted content will appear here.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case "idle":
      return "Idle";
    case "awaiting_key":
      return "Awaiting key";
    case "scanning":
      return "Scanning";
    case "complete":
      return "Complete";
    case "decrypted":
      return "Decrypted";
    default:
      return s;
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-2 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}
