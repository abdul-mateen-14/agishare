"use client";

import * as React from "react";
import {
  P2pReceiver,
  formatBytes,
  formatSpeed,
  type SenderEvents,
} from "@/lib/webrtc";
import {
  SignalAccumulator,
  parseCopyPasteCode,
  type SignalingPayload,
} from "@/lib/webrtc-signaling";
import { makeFileMeta } from "@/lib/file-crypto";
import {
  decodeFrame,
  type SignalFrame,
} from "@/lib/qr-protocol";
import { deriveKeyFromPassphrase, keyFromRaw } from "@/lib/crypto";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { QrCanvas } from "./qr-canvas";
import { useCameraScanner } from "./use-camera-scanner";
import {
  Lock,
  Loader2,
  CheckCircle2,
  Download,
  ClipboardCopy,
  Radio,
  Camera,
  XCircle,
  Wifi,
  FileDown,
} from "lucide-react";
import { toast } from "sonner";

type Phase =
  | "idle" // enter passphrase + offer
  | "answered" // showing answer, waiting for connection
  | "transferring"
  | "done"
  | "error";

export function P2pReceivePanel() {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [offerInput, setOfferInput] = React.useState("");
  const [usingPassphrase, setUsingPassphrase] = React.useState(true);
  const [passphrase, setPassphrase] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const [meta, setMeta] = React.useState<ReturnType<typeof makeFileMeta> | null>(null);
  const [answerFrames, setAnswerFrames] = React.useState<string[]>([]);
  const [answerCursor, setAnswerCursor] = React.useState(0);
  const [frameMs, setFrameMs] = React.useState(220);
  const [answerCode, setAnswerCode] = React.useState("");

  const [gotChunks, setGotChunks] = React.useState(0);
  const [totalChunks, setTotalChunks] = React.useState(0);
  const [speed, setSpeed] = React.useState(0);
  const [downloadUrl, setDownloadUrl] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [scanMode, setScanMode] = React.useState<"paste" | "scan">("paste");

  const receiverRef = React.useRef<P2pReceiver | null>(null);
  const keyHandleRef = React.useRef<CryptoKey | null>(null);
  const accumulatorRef = React.useRef<SignalAccumulator>(new SignalAccumulator());
  const [scanProgress, setScanProgress] = React.useState({ have: 0, total: 0 });

  // QR answer cycler
  React.useEffect(() => {
    if (phase !== "answered" || answerFrames.length === 0) return;
    const id = window.setInterval(() => {
      setAnswerCursor((c) => (c + 1) % answerFrames.length);
    }, Math.max(80, frameMs));
    return () => window.clearInterval(id);
  }, [phase, answerFrames.length, frameMs]);

  // ---- scan handler (offer QRs) ----
  const handleScan = React.useCallback(async (r: { data: string }) => {
    const frame = decodeFrame(r.data);
    if (!frame || frame.m !== "S") return;
    const acc = accumulatorRef.current;
    const payload = acc.push(frame as SignalFrame);
    setScanProgress({ have: acc.have, total: acc.total });
    if (payload) {
      setOfferInput(`scanned:${payload.id}`); // marker so UI knows it's loaded
      accumulatorRef.current.reset();
      await acceptOfferInternal(payload);
    }
  }, []);

  const { videoRef, canvasRef, start, stop, cameraState } = useCameraScanner(
    handleScan,
    (msg) => toast.error(msg),
  );

  async function acceptOfferInternal(payload: SignalingPayload) {
    try {
      if (payload.role !== "offer") throw new Error("Expected an offer");
      if (!payload.meta) throw new Error("Offer is missing file metadata");

      // key
      let keyHandle: CryptoKey;
      if (payload.meta.keyOrigin === "auto" && payload.key) {
        const km = await keyFromRaw(payload.key, "auto");
        keyHandle = km.handle;
        setUsingPassphrase(false);
      } else {
        if (passphraseRef.current.length < 4) {
          setMeta(payload.meta);
          setPhase("idle");
          toast.error("Enter the passphrase the sender gave you, then connect.");
          stashRef.current = payload;
          return;
        }
        const { key } = await deriveKeyFromPassphrase(
          passphraseRef.current,
          Uint8Array.from(atob(payload.meta.salt ?? ""), (ch) => ch.charCodeAt(0)),
        );
        keyHandle = key.handle;
      }
      keyHandleRef.current = keyHandle;

      const receiver = new P2pReceiver({
        onConnected: () => {
          setPhase("transferring");
          toast.success("P2P channel open — receiving…");
        },
        onProgress: (c, t, bps) => {
          setGotChunks(c);
          setTotalChunks(t);
          setSpeed(bps);
        },
        onDone: (blob) => {
          const url = URL.createObjectURL(blob);
          setDownloadUrl(url);
          setPhase("done");
          toast.success("File received and decrypted!");
        },
        onError: (m) => {
          setErrorMsg(m);
          setPhase("error");
          toast.error(m);
        },
      } satisfies SenderEvents);
      receiverRef.current = receiver;
      receiver.prepare(payload.meta, keyHandle);
      setMeta(payload.meta);
      setTotalChunks(payload.meta.totalChunks);

      await receiver.acceptOffer(payload.sdp);

      const answerPayload: SignalingPayload = {
        role: "answer",
        id: payload.id,
        sdp: receiver.pc.localDescription?.sdp ?? "",
      };
      const frames = (await import("@/lib/webrtc-signaling")).encodeSignalFrames(
        (await import("@/lib/webrtc-signaling")).makeSignalFrames(answerPayload),
      );
      setAnswerFrames(frames);
      setAnswerCode((await import("@/lib/webrtc-signaling")).makeCopyPasteCode(answerPayload));
      setPhase("answered");
      toast.info("Give the answer back to the sender — QR or code.");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErrorMsg(m);
      setPhase("error");
      toast.error(m);
    }
  }

  // refs for latest passphrase inside the scan callback
  const passphraseRef = React.useRef("");
  React.useEffect(() => {
    passphraseRef.current = passphrase;
  }, [passphrase]);
  const stashRef = React.useRef<SignalingPayload | null>(null);

  // called by the "Connect" button (paste path, or re-connect after passphrase)
  async function handleConnectFromPaste() {
    const raw = offerInput.trim();
    if (!raw) return;
    setBusy(true);
    try {
      let payload: SignalingPayload | null = null;
      if (raw.startsWith("A1S.")) {
        payload = parseCopyPasteCode(raw);
      } else if (raw.startsWith("scanned:")) {
        payload = stashRef.current;
      } else {
        // try accumulating scanned frames pasted as lines
        const acc = new SignalAccumulator();
        for (const line of raw.split(/\r?\n/)) {
          const f = decodeFrame(line.trim());
          if (f && f.m === "S") {
            const done = acc.push(f as SignalFrame);
            if (done) {
              payload = done;
              break;
            }
          }
        }
      }
      if (!payload) throw new Error("Could not parse offer — paste the full code or scan all frames");
      stashRef.current = payload;
      await acceptOfferInternal(payload);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    receiverRef.current?.cancel();
    receiverRef.current = null;
    setPhase("idle");
    setAnswerFrames([]);
    setAnswerCode("");
    setMeta(null);
    setGotChunks(0);
    setSpeed(0);
    setDownloadUrl(null);
    setOfferInput("");
    accumulatorRef.current.reset();
  }

  const progress = totalChunks ? (gotChunks / totalChunks) * 100 : 0;
  const passphraseOk = !usingPassphrase || passphrase.length >= 4;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* Left */}
      <div className="space-y-4 min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Wifi className="size-4" />
              </span>
              Direct P2P — receive
            </CardTitle>
            <CardDescription>
              Take the sender&apos;s offer (scan their QR or paste their code),
              then give your answer back. The file streams encrypted, direct.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {phase === "idle" || phase === "error" ? (
              <>
                <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <Lock className="size-3.5 text-primary" />
                      Passphrase mode
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      On = type the sender&apos;s passphrase. Off = auto key
                      (embedded in their offer).
                    </p>
                  </div>
                  <Switch
                    checked={usingPassphrase}
                    onCheckedChange={setUsingPassphrase}
                  />
                </div>
                {usingPassphrase && (
                  <div className="space-y-2">
                    <Label htmlFor="p2p-pp" className="text-xs">Passphrase</Label>
                    <Input
                      id="p2p-pp"
                      type="text"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="The passphrase the sender gave you"
                      className="font-mono text-sm"
                      autoComplete="off"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Sender&apos;s offer</Label>
                    <div className="flex rounded-lg border border-border p-0.5 text-xs">
                      <button
                        className={`rounded-md px-3 py-1.5 flex items-center gap-1.5 transition ${
                          scanMode === "paste"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setScanMode("paste")}
                      >
                        Paste code
                      </button>
                      <button
                        className={`rounded-md px-3 py-1.5 flex items-center gap-1.5 transition ${
                          scanMode === "scan"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setScanMode("scan")}
                      >
                        <Camera className="size-3.5" /> Scan QR
                      </button>
                    </div>
                  </div>
                  {scanMode === "paste" ? (
                    <Textarea
                      value={offerInput}
                      onChange={(e) => setOfferInput(e.target.value)}
                      placeholder="Paste the sender's A1S.… offer code here"
                      rows={4}
                      className="font-mono text-xs"
                    />
                  ) : (
                    <div className="space-y-2">
                      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black ring-1 ring-border">
                        <video ref={videoRef} className="size-full object-cover" muted playsInline />
                        <canvas ref={canvasRef} className="hidden" />
                        {cameraState.kind !== "running" && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                            {cameraState.kind === "error" ? (
                              <>
                                <XCircle className="size-7 text-destructive" />
                                <p className="text-xs text-destructive max-w-[240px]">
                                  {cameraState.message}
                                </p>
                                <Button size="sm" variant="outline" onClick={start}>
                                  Try again
                                </Button>
                              </>
                            ) : (
                              <Button size="sm" onClick={start}>
                                <Camera className="size-3.5" /> Start camera
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                      {scanProgress.total > 0 && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" />
                          Offer frames: {scanProgress.have}/{scanProgress.total}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <Button
                  onClick={handleConnectFromPaste}
                  disabled={
                    busy ||
                    !offerInput.trim() ||
                    !passphraseOk ||
                    (scanMode === "scan" && cameraState.kind === "running" && scanProgress.have === 0)
                  }
                  className="w-full"
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Generating answer…
                    </>
                  ) : (
                    <>
                      <Radio className="size-4" /> Connect &amp; generate answer
                    </>
                  )}
                </Button>

                {meta && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
                    <div className="font-medium">{meta.name}</div>
                    <div className="text-muted-foreground">
                      {formatBytes(meta.size)} · {meta.totalChunks} chunks ·{" "}
                      {meta.keyOrigin === "passphrase" ? "passphrase mode" : "auto key"}
                    </div>
                  </div>
                )}
                {errorMsg && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                    {errorMsg}
                  </div>
                )}
              </>
            ) : phase === "answered" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Radio className="size-4 text-primary animate-pulse" />
                  Waiting for the sender to connect
                </div>
                <p className="text-xs text-muted-foreground">
                  They need your answer below — QR (phones) or code (laptops).
                </p>
                {meta && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileDown className="size-3.5 text-primary" />
                    {meta.name} · {formatBytes(meta.size)}
                  </div>
                )}
                <Button variant="ghost" size="sm" onClick={handleCancel} className="w-full">
                  Cancel
                </Button>
              </div>
            ) : phase === "transferring" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  Receiving {meta?.name}
                </div>
                <Progress value={progress} className="h-2.5" />
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="Chunks" value={`${gotChunks}/${totalChunks}`} />
                  <Stat label="Speed" value={formatSpeed(speed)} />
                  <Stat label="Progress" value={`${progress.toFixed(0)}%`} />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-8">
                <CheckCircle2 className="size-10 text-primary" />
                <div className="text-sm font-medium">Received &amp; decrypted</div>
                <div className="text-xs text-muted-foreground">
                  {meta?.name} ({formatBytes(meta?.size ?? 0)})
                </div>
                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    download={meta?.name ?? "aegis-file"}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Download className="size-4" /> Save file
                  </a>
                )}
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  Receive another
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right: answer QR + code */}
      <Card className="lg:w-[360px]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider">
            Answer
          </CardTitle>
          <CardDescription className="text-[11px]">
            {phase === "answered"
              ? "Give this back to the sender"
              : "Answer appears after you connect"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {phase === "answered" && answerFrames.length > 0 ? (
            <>
              <div className="mx-auto w-full max-w-[280px]">
                <div className="relative overflow-hidden rounded-2xl bg-white p-3 shadow-lg ring-1 ring-primary/20">
                  <QrCanvas value={answerFrames[answerCursor]} size={280} className="size-full" />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    ANSWER {answerCursor + 1}/{answerFrames.length}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {frameMs}ms/frame
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Laptop? Copy-paste instead
                </div>
                <Textarea
                  readOnly
                  value={answerCode}
                  rows={4}
                  className="font-mono text-[10px] break-all"
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    navigator.clipboard?.writeText(answerCode);
                    toast.success("Answer code copied");
                  }}
                >
                  <ClipboardCopy className="size-3.5" /> Copy answer code
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-xs text-muted-foreground">
              {phase === "idle" || phase === "error"
                ? "Connect with the sender's offer to generate your answer."
                : phase === "transferring" || phase === "done"
                ? "Channel open — signaling no longer needed."
                : "Waiting…"}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
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
