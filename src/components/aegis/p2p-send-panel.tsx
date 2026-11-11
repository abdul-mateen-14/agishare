"use client";

import * as React from "react";
import { P2pSender, formatBytes, formatSpeed } from "@/lib/webrtc";
import { makeFileMeta } from "@/lib/file-crypto";
import {
  makeSignalFrames,
  encodeSignalFrames,
  makeCopyPasteCode,
  newSessionId,
  type SignalingPayload,
} from "@/lib/webrtc-signaling";
import { deriveKeyFromPassphrase, generateAutoKey, bytesToB64 } from "@/lib/crypto";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { QrCanvas } from "./qr-canvas";
import {
  FileUp,
  Loader2,
  Lock,
  Radio,
  ArrowRight,
  Camera,
  ClipboardCopy,
  ClipboardPaste,
  CheckCircle2,
  XCircle,
  Wifi,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

type Phase =
  | "idle" // pick file
  | "signaling" // showing offer, waiting for answer
  | "connecting" // got answer, ICE connecting
  | "transferring"
  | "done"
  | "error";

export function P2pSendPanel() {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [file, setFile] = React.useState<File | null>(null);
  const [usePassphrase, setUsePassphrase] = React.useState(true);
  const [passphrase, setPassphrase] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // signaling
  const [offerFrames, setOfferFrames] = React.useState<string[]>([]);
  const [cursor, setCursor] = React.useState(0);
  const [frameMs, setFrameMs] = React.useState(220);
  const [copyCode, setCopyCode] = React.useState("");
  const [answerInput, setAnswerInput] = React.useState("");
  const [scanAnswerMode, setScanAnswerMode] = React.useState<"paste" | "scan">("paste");

  // transfer progress
  const [sentChunks, setSentChunks] = React.useState(0);
  const [totalChunks, setTotalChunks] = React.useState(0);
  const [speed, setSpeed] = React.useState(0);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const senderRef = React.useRef<P2pSender | null>(null);
  const fileMetaRef = React.useRef<{ meta: ReturnType<typeof makeFileMeta>; keyHandle: CryptoKey } | null>(null);

  // QR cycler
  React.useEffect(() => {
    if (phase !== "signaling" || offerFrames.length === 0) return;
    const id = window.setInterval(() => {
      setCursor((c) => (c + 1) % offerFrames.length);
    }, Math.max(80, frameMs));
    return () => window.clearInterval(id);
  }, [phase, offerFrames.length, frameMs]);

  async function handleStart() {
    if (!file || (usePassphrase && passphrase.length < 4)) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const sessionId = newSessionId();
      let keyHandle: CryptoKey;
      let saltB64: string | undefined;
      let autoKeyB64: string | undefined;

      if (usePassphrase) {
        const { key, salt } = await deriveKeyFromPassphrase(passphrase);
        keyHandle = key.handle;
        saltB64 = bytesToB64(salt);
      } else {
        const auto = await generateAutoKey();
        keyHandle = auto.handle;
        autoKeyB64 = auto.raw;
      }

      const meta = makeFileMeta(file, sessionId, usePassphrase ? "passphrase" : "auto", saltB64);
      fileMetaRef.current = { meta, keyHandle };
      setTotalChunks(meta.totalChunks);

      const sender = new P2pSender({
        onConnected: () => {
          setPhase("transferring");
          toast.success("P2P channel open — transferring…");
        },
        onProgress: (c, t, bps) => {
          setSentChunks(c);
          setTotalChunks(t);
          setSpeed(bps);
        },
        onDone: () => {
          setPhase("done");
          toast.success("Transfer complete!");
        },
        onError: (m) => {
          setErrorMsg(m);
          setPhase("error");
          toast.error(m);
        },
      });
      senderRef.current = sender;

      await sender.start(file, meta, keyHandle);

      const payload: SignalingPayload = {
        role: "offer",
        id: sessionId,
        sdp: sender.pc.localDescription?.sdp ?? "",
        meta,
        key: autoKeyB64,
      };
      const frames = encodeSignalFrames(makeSignalFrames(payload));
      setOfferFrames(frames);
      setCopyCode(makeCopyPasteCode(payload));
      setCursor(0);
      setPhase("signaling");
      toast.info("Share the offer with the receiver — QR or code.");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErrorMsg(m);
      setPhase("error");
      toast.error(m);
    } finally {
      setBusy(false);
    }
  }

  async function handleAnswerSubmit() {
    const sender = senderRef.current;
    if (!sender || !answerInput.trim()) return;
    setBusy(true);
    try {
      // Accept both copy-paste codes and scanned QR frames (multi-line)
      const raw = answerInput.trim();
      let sdp: string | null = null;
      if (raw.startsWith("A1S.")) {
        const { parseCopyPasteCode } = await import("@/lib/webrtc-signaling");
        const payload = parseCopyPasteCode(raw);
        if (!payload || payload.role !== "answer") throw new Error("Not an answer code");
        sdp = payload.sdp;
      } else {
        // try scanning each line as an AEGIS1 frame
        const { decodeFrame } = await import("@/lib/qr-protocol");
        const parts = new Map<number, string>();
        let n = -1;
        for (const line of raw.split(/\r?\n/)) {
          const f = decodeFrame(line.trim());
          if (f && f.m === "S" && f.r === "answer") {
            n = f.n;
            parts.set(f.i, f.p);
          }
        }
        if (n > 0 && parts.size >= n) {
          let b64 = "";
          for (let i = 0; i < n; i++) b64 += parts.get(i) ?? "";
          const json = new TextDecoder().decode(
            Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)),
          );
          const payload = JSON.parse(json) as { role: string; sdp: string };
          if (payload.role !== "answer") throw new Error("Not an answer");
          sdp = payload.sdp;
        }
      }
      if (!sdp) throw new Error("Could not parse answer — paste the full code or scan all frames");
      await sender.acceptAnswer(sdp);
      setPhase("connecting");
      setAnswerInput("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    senderRef.current?.cancel();
    senderRef.current = null;
    setPhase("idle");
    setOfferFrames([]);
    setCopyCode("");
    setAnswerInput("");
    setSentChunks(0);
    setSpeed(0);
  }

  const progress = totalChunks ? (sentChunks / totalChunks) * 100 : 0;
  const canStart = !!file && (!usePassphrase || passphrase.length >= 4);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* Left: setup / status */}
      <div className="space-y-4 min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Wifi className="size-4" />
              </span>
              Direct P2P — large files
            </CardTitle>
            <CardDescription>
              MB-to-GB files stream directly device-to-device over Wi-Fi/LAN or
              the internet. No server touches your bytes — everything is
              AES-GCM encrypted before it leaves this browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {phase === "idle" || phase === "error" ? (
              <>
                <Label
                  htmlFor="p2p-file-in"
                  className="flex h-36 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm transition hover:bg-muted/60"
                >
                  {file ? (
                    <>
                      <FileUp className="size-6 text-primary" />
                      <span className="font-medium">{file.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatBytes(file.size)} · click to replace
                      </span>
                    </>
                  ) : (
                    <>
                      <FileUp className="size-6 text-muted-foreground" />
                      <span>Pick any file — 10 MB, 500 MB, 4 GB…</span>
                      <span className="text-[11px] text-muted-foreground">
                        streamed in 64 KB encrypted chunks, flat memory usage
                      </span>
                    </>
                  )}
                </Label>
                <Input
                  id="p2p-file-in"
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPhase("idle");
                  }}
                />

                <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        <Lock className="size-3.5 text-primary" />
                        Passphrase mode
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Recommended. Share the passphrase out-of-band (voice,
                        chat). Off = auto key embedded in the offer QR/code.
                      </p>
                    </div>
                    <Switch
                      checked={usePassphrase}
                      onCheckedChange={setUsePassphrase}
                      aria-label="Use passphrase"
                    />
                  </div>
                  {usePassphrase && (
                    <Input
                      type="text"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Passphrase (min 4 chars)"
                      className="font-mono text-sm"
                      autoComplete="off"
                    />
                  )}
                </div>

                <Button onClick={handleStart} disabled={!canStart || busy} size="lg" className="w-full">
                  {busy ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Preparing offer…
                    </>
                  ) : (
                    <>
                      <Radio className="size-4" /> Start P2P transfer
                    </>
                  )}
                </Button>
                {errorMsg && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                    {errorMsg}
                  </div>
                )}
              </>
            ) : phase === "signaling" ? (
              <>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Radio className="size-4 text-primary animate-pulse" />
                  Waiting for the receiver&apos;s answer
                </div>
                <p className="text-xs text-muted-foreground">
                  Give them the offer below (QR for phones with camera, or the
                  code for laptops). They&apos;ll send back an answer — paste or
                  scan it.
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex rounded-lg border border-border p-0.5 text-xs">
                      <button
                        className={`rounded-md px-3 py-1.5 flex items-center gap-1.5 transition ${
                          scanAnswerMode === "paste"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setScanAnswerMode("paste")}
                      >
                        <ClipboardPaste className="size-3.5" /> Paste answer
                      </button>
                      <button
                        className={`rounded-md px-3 py-1.5 flex items-center gap-1.5 transition ${
                          scanAnswerMode === "scan"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setScanAnswerMode("scan")}
                      >
                        <Camera className="size-3.5" /> Scan answer QR
                      </button>
                    </div>
                  </div>
                  <Textarea
                    value={answerInput}
                    onChange={(e) => setAnswerInput(e.target.value)}
                    placeholder={
                      scanAnswerMode === "paste"
                        ? "Paste the A1S.… answer code here"
                        : "Scan each answer QR with your webcam — the frames accumulate here"
                    }
                    rows={4}
                    className="font-mono text-xs"
                  />
                  <Button
                    onClick={handleAnswerSubmit}
                    disabled={!answerInput.trim() || busy}
                    className="w-full"
                    size="sm"
                  >
                    <ArrowRight className="size-3.5" /> Connect
                  </Button>
                </div>
                <Button variant="ghost" size="sm" onClick={handleCancel} className="w-full">
                  Cancel transfer
                </Button>
              </>
            ) : phase === "connecting" ? (
              <div className="flex items-center gap-3 py-8 justify-center flex-col">
                <Loader2 className="size-8 animate-spin text-primary" />
                <div className="text-sm text-muted-foreground">
                  Punching through NAT — connecting to peer…
                </div>
              </div>
            ) : phase === "transferring" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Zap className="size-4 text-accent" />
                  Streaming {file?.name}
                </div>
                <Progress value={progress} className="h-2.5" />
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="Sent" value={`${sentChunks}/${totalChunks}`} />
                  <Stat label="Speed" value={formatSpeed(speed)} />
                  <Stat label="Progress" value={`${progress.toFixed(0)}%`} />
                </div>
                <Button variant="ghost" size="sm" onClick={handleCancel} className="w-full">
                  <XCircle className="size-3.5" /> Cancel transfer
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-8">
                <CheckCircle2 className="size-10 text-primary" />
                <div className="text-sm font-medium">Transfer complete</div>
                <div className="text-xs text-muted-foreground">
                  {file?.name} delivered ({formatBytes(file?.size ?? 0)})
                </div>
                <Button variant="outline" size="sm" onClick={handleCancel}>
                  Send another file
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right: signaling QR + code */}
      <Card className="lg:w-[360px]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider">
            Signaling
          </CardTitle>
          <CardDescription className="text-[11px]">
            {phase === "signaling"
              ? "Offer — give this to the receiver"
              : "Offer appears after you start"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {phase === "signaling" && offerFrames.length > 0 ? (
            <>
              <div className="mx-auto w-full max-w-[280px]">
                <div className="relative overflow-hidden rounded-2xl bg-white p-3 shadow-lg ring-1 ring-primary/20">
                  <QrCanvas value={offerFrames[cursor]} size={280} className="size-full" />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    OFFER {cursor + 1}/{offerFrames.length}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {frameMs}ms/frame
                  </span>
                </div>
              </div>
              <Slider
                min={80}
                max={800}
                step={20}
                value={[frameMs]}
                onValueChange={(v) => setFrameMs(v[0] ?? frameMs)}
              />
              <div className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Laptop? Copy-paste instead
                </div>
                <Textarea
                  readOnly
                  value={copyCode}
                  rows={4}
                  className="font-mono text-[10px] break-all"
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    navigator.clipboard?.writeText(copyCode);
                    toast.success("Offer code copied");
                  }}
                >
                  <ClipboardCopy className="size-3.5" /> Copy offer code
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-xs text-muted-foreground">
              {phase === "idle" || phase === "error"
                ? "Start a transfer to generate the offer QR + code."
                : phase === "connecting" || phase === "transferring"
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
