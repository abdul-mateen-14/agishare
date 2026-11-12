"use client";

import * as React from "react";
import { useSendStore } from "@/lib/store";
import {
  deriveKeyFromPassphrase,
  encryptCombined,
  generateAutoKey,
  bytesToB64,
  strToBytes,
  randomId,
} from "@/lib/crypto";
import { chunkPayload, encodeFrame } from "@/lib/qr-protocol";
import {
  textToEnvelope,
  fileToEnvelope,
  envelopeToJson,
} from "@/lib/payload";
import { PROTOCOL } from "@/lib/brand";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Loader2, Lock, FileText, FileUp, Sparkles, Eraser } from "lucide-react";
import { QrDisplay } from "./qr-display";
import { toast } from "sonner";

export function QrSendPanel() {
  const store = useSendStore();
  const [tab, setTab] = React.useState<"text" | "file">("text");
  const [text, setText] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [usePassphrase, setUsePassphrase] = React.useState(false);
  const [passphrase, setPassphrase] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // estimate payload size for UX feedback
  const textSizeBytes = React.useMemo(() => strToBytes(text).length, [text]);
  const fileSizeBytes = file ? file.size : 0;
  const approxEncryptedBytes = Math.max(textSizeBytes, fileSizeBytes) * 1.34 + 128; // base64 overhead + envelope
  const approxChunks = Math.max(1, Math.ceil(approxEncryptedBytes / PROTOCOL.chunkBytes));
  const tooBig = approxEncryptedBytes > PROTOCOL.maxPayloadBytes;

  const canGenerate =
    !busy &&
    !tooBig &&
    (tab === "text" ? text.trim().length > 0 : !!file) &&
    (!usePassphrase || passphrase.length >= 4);

  async function handleGenerate() {
    if (!canGenerate) return;
    setBusy(true);
    try {
      // 1) Build payload envelope
      let env;
      if (tab === "text") {
        env = textToEnvelope(text);
      } else {
        if (!file) throw new Error("No file selected");
        env = await fileToEnvelope(file);
      }
      const envJson = envelopeToJson(env);

      // 2) Derive or generate the key
      let keyMaterial;
      let saltB64: string | undefined;
      let rawKeyB64: string | undefined;
      if (usePassphrase) {
        const { key, salt } = await deriveKeyFromPassphrase(passphrase);
        keyMaterial = key;
        saltB64 = bytesToB64(salt);
      } else {
        keyMaterial = await generateAutoKey();
        rawKeyB64 = keyMaterial.raw;
      }

      // 3) Encrypt (combined iv || ct so the IV travels inside chunk 0)
      const combined = await encryptCombined(keyMaterial, strToBytes(envJson));
      const combinedB64 = bytesToB64(combined);
      // 4) Build chunked DATA frames (hash the combined bytes — IV + ct)
      const sessionId = randomId().slice(0, 6);
      const chunked = await chunkPayload(combinedB64, sessionId);

      // 5) Build KEY frame
      let keyFrame: string | null = null;
      if (usePassphrase && saltB64) {
        keyFrame = encodeFrame({
          m: "K",
          o: "passphrase",
          k: "", // empty — key isn't sent over the air in passphrase mode
          s: saltB64,
        });
      } else if (rawKeyB64) {
        keyFrame = encodeFrame({
          m: "K",
          o: "auto",
          k: rawKeyB64,
        });
      }

      store.setSend({
        status: "ready",
        keyFrame,
        dataFrames: chunked.frames,
        sessionId,
        hashHex: chunked.hashHex,
        totalChunks: chunked.totalChunks,
        cursor: 0,
        loops: 0,
        previewText: tab === "text" ? text : "",
        fileName: tab === "file" ? file?.name ?? null : null,
        fileMime: tab === "file" ? file?.type ?? null : null,
        keyOrigin: usePassphrase ? "passphrase" : "auto",
        rawKeyB64: rawKeyB64 ?? null,
      });

      toast.success(
        `Ready! ${chunked.totalChunks} QR frame${chunked.totalChunks === 1 ? "" : "s"} — press Broadcast.`,
      );
    } catch (e: unknown) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
      {/* Left: input controls */}
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Lock className="size-4" />
            </span>
            Send
          </CardTitle>
          <CardDescription>
            Encrypt text or a file in your browser, then broadcast as animated QR
            codes the receiver scans with their camera.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "text" | "file")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="text">
                <FileText className="size-3.5" />
                Text
              </TabsTrigger>
              <TabsTrigger value="file">
                <FileUp className="size-3.5" />
                File
              </TabsTrigger>
            </TabsList>
            <TabsContent value="text" className="mt-3 space-y-2">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type or paste a secret — password, message, wallet seed, API token…"
                rows={6}
                className="resize-y font-mono text-sm"
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{textSizeBytes.toLocaleString()} bytes</span>
                <span>~{approxChunks} frame{approxChunks === 1 ? "" : "s"}</span>
              </div>
            </TabsContent>
            <TabsContent value="file" className="mt-3 space-y-2">
              <Label
                htmlFor="file-in"
                className="flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm transition hover:bg-muted/60"
              >
                {file ? (
                  <>
                    <FileUp className="size-6 text-primary" />
                    <span className="font-medium">{file.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB · click to replace
                    </span>
                  </>
                ) : (
                  <>
                    <FileUp className="size-6 text-muted-foreground" />
                    <span>Drop a file or click to choose</span>
                    <span className="text-[11px] text-muted-foreground">
                      max ~1 MB · binary safe
                    </span>
                  </>
                )}
              </Label>
              <Input
                id="file-in"
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                }}
              />
              {file && (
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{(file.size / 1024).toFixed(1)} KB</span>
                  <span>~{approxChunks} frame{approxChunks === 1 ? "" : "s"}</span>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* Encryption mode */}
          <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Lock className="size-3.5 text-primary" />
                  Passphrase mode
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Share the passphrase out-of-band. Otherwise we auto-generate a key
                  and show it as a separate Key QR.
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
            {!usePassphrase && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Sparkles className="size-3.5 text-accent" />
                Auto key — press Generate and we&apos;ll mint a 256-bit key in
                your browser.
              </div>
            )}
          </div>

          {/* Frame timing slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <Label className="text-muted-foreground">Frame dwell time</Label>
              <span className="font-mono">{store.frameMs}ms</span>
            </div>
            <Slider
              min={80}
              max={800}
              step={20}
              value={[store.frameMs]}
              onValueChange={(v) => store.setSend({ frameMs: v[0] ?? store.frameMs })}
            />
            <p className="text-[11px] text-muted-foreground">
              Slower = easier to scan, faster = quicker transfer. ~200ms works on
              most phones.
            </p>
          </div>

          {/* CTA */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={handleGenerate}
              disabled={!canGenerate}
              size="lg"
              className="flex-1"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Encrypting…
                </>
              ) : (
                <>
                  <Lock className="size-4" />
                  Encrypt &amp; Generate QRs
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setText("");
                setFile(null);
                store.reset();
              }}
              disabled={busy}
            >
              <Eraser className="size-4" /> Clear
            </Button>
          </div>

          {tooBig && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              Payload too large ({(approxEncryptedBytes / 1024).toFixed(0)} KB
              estimated). Limit is {(PROTOCOL.maxPayloadBytes / 1024 / 1024).toFixed(1)} MB.
              Split the file or shorten the text.
            </div>
          )}

          {/* Status badges */}
          {store.status !== "idle" && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Badge variant="secondary" className="font-mono text-[10px]">
                {store.keyOrigin === "passphrase" ? "PBKDF2 + AES-GCM" : "AES-GCM 256"}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                {store.totalChunks} chunk{store.totalChunks === 1 ? "" : "s"}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                sid {store.sessionId}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Right: QR display */}
      <Card className="lg:w-[460px]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider">
            Broadcast
          </CardTitle>
          <CardDescription className="text-[11px]">
            Point the receiver&apos;s camera at this screen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QrDisplay />
        </CardContent>
      </Card>
    </div>
  );
}
