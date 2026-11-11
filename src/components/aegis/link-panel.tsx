"use client";

import * as React from "react";
import {
  deriveKeyFromPassphrase,
  generateAutoKey,
  encryptCombined,
  decryptCombined,
  keyFromRaw,
  bytesToB64,
  strToBytes,
  b64ToBytes,
  type KeyMaterial,
} from "@/lib/crypto";
import {
  buildLink,
  parseLink,
  LINK_SAFE_CHARS,
  LINK_MAX_CHARS,
} from "@/lib/link-transfer";
import { textToEnvelope, fileToEnvelope, envelopeToJson, envelopeFromJson, envelopeToBlob } from "@/lib/payload";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { QrCanvas } from "./qr-canvas";
import {
  Link2,
  Copy,
  Check,
  Lock,
  FileUp,
  Loader2,
  ShieldAlert,
  Unlock,
  Download,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";

/* ============================================================
   SEND — build a share link
   ============================================================ */

export function LinkSendPanel() {
  const [tab, setTab] = React.useState<"text" | "file">("text");
  const [text, setText] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [usePassphrase, setUsePassphrase] = React.useState(false);
  const [passphrase, setPassphrase] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [generated, setGenerated] = React.useState<{
    url: string;
    keyOrigin: "auto" | "passphrase";
    key: string | null;
  } | null>(null);
  const [revealed, setRevealed] = React.useState(false);

  const approxDataChars = React.useMemo(() => {
    // rough estimate: base64 of (envelope JSON → encrypted)
    const raw = tab === "text" ? strToBytes(text).length : (file?.size ?? 0);
    return Math.ceil(raw * 1.34 + 256);
  }, [tab, text, file]);

  const tooBig = approxDataChars > LINK_MAX_CHARS;

  async function handleGenerate() {
    if (busy || tooBig) return;
    if (tab === "text" && !text.trim()) return;
    if (tab === "file" && !file) return;
    if (usePassphrase && passphrase.length < 4) return;
    setBusy(true);
    try {
      const env =
        tab === "text" ? textToEnvelope(text) : await fileToEnvelope(file!);
      const envJson = envelopeToJson(env);

      let keyMaterial: KeyMaterial;
      let saltB64: string;
      let autoKeyB64: string | null = null;
      if (usePassphrase) {
        const { key, salt } = await deriveKeyFromPassphrase(passphrase);
        keyMaterial = key;
        saltB64 = bytesToB64(salt);
      } else {
        const auto = await generateAutoKey();
        keyMaterial = auto;
        autoKeyB64 = auto.raw;
        // auto mode: salt is irrelevant, but keep one for format consistency
        saltB64 = bytesToB64(new Uint8Array(16));
      }

      const combined = await encryptCombined(keyMaterial, strToBytes(envJson));
      const dataB64 = bytesToB64(combined);
      const base = typeof window !== "undefined" ? window.location.origin : "https://aegishare.app";
      const url = buildLink(base, usePassphrase ? "passphrase" : "auto", saltB64, autoKeyB64, dataB64);
      setGenerated({
        url,
        keyOrigin: usePassphrase ? "passphrase" : "auto",
        key: autoKeyB64,
      });
      setRevealed(false);
    } catch (e) {
      console.error("[aegis] link generate failed:", e);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const urlLen = generated ? generated.url.length : 0;

  return (
    <div className="space-y-4 min-w-0">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Link2 className="size-4" />
            </span>
            Share link — small files
          </CardTitle>
          <CardDescription>
            Laptop-friendly: the encrypted payload rides in the URL fragment,
            which is never sent to any server. Share the link via chat, email,
            or AirDrop — the receiver opens it and decrypts locally.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!generated ? (
            <>
              <Tabs value={tab} onValueChange={(v) => setTab(v as "text" | "file")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="text">Text</TabsTrigger>
                  <TabsTrigger value="file">File</TabsTrigger>
                </TabsList>
                <TabsContent value="text" className="mt-3 space-y-2">
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Secret text — links, keys, notes…"
                    rows={6}
                    className="resize-y font-mono text-sm"
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>~{approxDataChars.toLocaleString()} URL chars</span>
                    <span>{approxDataChars <= LINK_SAFE_CHARS ? "chat-app safe" : "large — prefer direct paste"}</span>
                  </div>
                </TabsContent>
                <TabsContent value="file" className="mt-3 space-y-2">
                  <Label
                    htmlFor="link-file-in"
                    className="flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm transition hover:bg-muted/60"
                  >
                    {file ? (
                      <>
                        <FileUp className="size-6 text-primary" />
                        <span className="font-medium">{file.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatBytesShort(file.size)} · click to replace
                        </span>
                      </>
                    ) : (
                      <>
                        <FileUp className="size-6 text-muted-foreground" />
                        <span>Pick a small file (up to ~90 KB)</span>
                        <span className="text-[11px] text-muted-foreground">
                          bigger files? use QR or P2P mode
                        </span>
                      </>
                    )}
                  </Label>
                  <Input
                    id="link-file-in"
                    type="file"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </TabsContent>
              </Tabs>

              <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <Lock className="size-3.5 text-primary" />
                      Passphrase mode
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      On = link is useless without the passphrase (share it
                      separately). Off = anyone with the link can decrypt.
                    </p>
                  </div>
                  <Switch checked={usePassphrase} onCheckedChange={setUsePassphrase} />
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

              {tooBig && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  Payload too large for a link (~{approxDataChars.toLocaleString()} chars).
                  Use QR mode (up to 1.5 MB) or P2P mode (GB-scale).
                </div>
              )}

              <Button
                onClick={handleGenerate}
                disabled={
                  busy ||
                  tooBig ||
                  (tab === "text" ? !text.trim() : !file) ||
                  (usePassphrase && passphrase.length < 4)
                }
                size="lg"
                className="w-full"
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Encrypting…
                  </>
                ) : (
                  <>
                    <Link2 className="size-4" /> Create encrypted link
                  </>
                )}
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={generated.keyOrigin === "passphrase" ? "default" : "secondary"} className="font-mono text-[10px]">
                  {generated.keyOrigin === "passphrase" ? "passphrase-protected" : "anyone with link"}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {urlLen.toLocaleString()} chars
                </Badge>
                {urlLen > LINK_SAFE_CHARS && (
                  <Badge variant="outline" className="text-[10px] text-accent">
                    <ShieldAlert className="size-3" /> may truncate in some chat apps
                  </Badge>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Encrypted share link</Label>
                <Textarea
                  readOnly
                  value={generated.url}
                  rows={5}
                  className="font-mono text-[10px] break-all"
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      navigator.clipboard?.writeText(generated.url);
                      toast.success("Link copied — send it via any channel");
                    }}
                  >
                    <Copy className="size-3.5" /> Copy link
                  </Button>
                  <Button variant="outline" onClick={() => setGenerated(null)}>
                    New link
                  </Button>
                </div>
              </div>

              {generated.keyOrigin === "auto" && (
                <div className="flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 p-2 text-xs">
                  <Unlock className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  <span>
                    Auto-key mode: <b>anyone with this link can read the
                    content</b>. The decryption key is embedded in the fragment.
                    For sensitive data, switch to passphrase mode and share the
                    passphrase out-of-band.
                  </span>
                </div>
              )}
              {generated.keyOrigin === "passphrase" && (
                <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-2 text-xs">
                  <Lock className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <span>
                    Passphrase mode: the link is inert without your passphrase.
                    Share it separately (voice, chat, whatever).
                  </span>
                </div>
              )}

              {/* small QR of the URL for phones */}
              {generated.url.length < 2400 && (
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="size-24 shrink-0 rounded bg-white p-1">
                    <QrCanvas value={generated.url} size={88} className="size-full" />
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    <div className="font-medium text-foreground">Bonus: phone scan</div>
                    The link is short enough for one QR — phones can scan it
                    instead of opening the URL manually.
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================
   RECEIVE — open a link (also auto-triggered by #a1. in the URL)
   ============================================================ */

export function LinkReceivePanel({
  initialPayload,
  onConsumed,
}: {
  initialPayload?: string | null;
  onConsumed?: () => void;
}) {
  const [input, setInput] = React.useState("");
  const [parsed, setParsed] = React.useState<ReturnType<typeof parseLink>>(null);
  const [passphrase, setPassphrase] = React.useState("");
  const [passphraseVisible, setPassphraseVisible] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{
    text: string | null;
    fileName: string | null;
    mime: string | null;
    blobUrl: string | null;
    size: number;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const parse = React.useCallback(
    (raw: string) => {
      // Accept a full URL or just the fragment
      const hashIdx = raw.indexOf("#");
      const hash = hashIdx >= 0 ? raw.slice(hashIdx) : raw.startsWith("#") ? raw : `#${raw}`;
      const p = parseLink(hash);
      if (!p) {
        setError("Not an Aegis Share link — check the input");
        return null;
      }
      setError(null);
      return p;
    },
    [],
  );

  // Auto-parse when a hash payload is passed in from the page-level hook
  React.useEffect(() => {
    if (initialPayload) {
      const p = parse(initialPayload);
      if (p) setParsed(p);
      onConsumed?.();
    }
  }, [initialPayload, parse, onConsumed]);

  async function handleDecrypt() {
    if (!parsed) return;
    if (parsed.keyOrigin === "passphrase" && passphrase.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      let keyMaterial: KeyMaterial;
      if (parsed.keyOrigin === "auto" && parsed.key) {
        keyMaterial = await keyFromRaw(parsed.key, "auto");
      } else {
        const salt = b64ToBytes(parsed.salt);
        keyMaterial = (await deriveKeyFromPassphrase(passphrase, salt)).key;
      }
      const plaintext = await decryptCombined(keyMaterial, b64ToBytes(parsed.data));
      const env = envelopeFromJson(new TextDecoder().decode(plaintext));
      const { blob, text } = envelopeToBlob(env);
      const blobUrl = URL.createObjectURL(blob);
      setResult({
        text: env.kind === "text" ? text : null,
        fileName: env.kind === "file" ? env.name ?? "aegis-file" : null,
        mime: env.mime ?? null,
        blobUrl,
        size: blob.size,
      });
      toast.success("Decrypted successfully");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(
        m.includes("operation failed") || m.includes("decrypt")
          ? "Decryption failed — wrong passphrase or corrupted link"
          : m,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 min-w-0">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Link2 className="size-4" />
            </span>
            Open share link
          </CardTitle>
          <CardDescription>
            Paste an Aegis Share link (or open one directly — links with{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">#a1.</code>{" "}
            fragments are picked up automatically).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!parsed ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="link-in" className="text-xs">Aegis Share link</Label>
                <Input
                  id="link-in"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="https://…/#a1.a.…"
                  className="font-mono text-xs"
                />
              </div>
              <Button
                onClick={() => {
                  const p = parse(input.trim());
                  if (p) setParsed(p);
                }}
                disabled={!input.trim()}
                className="w-full"
              >
                <Link2 className="size-4" /> Load link
              </Button>
              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {error}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={parsed.keyOrigin === "passphrase" ? "default" : "secondary"} className="font-mono text-[10px]">
                  {parsed.keyOrigin === "passphrase" ? "passphrase-protected" : "auto key in link"}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px]">
                  payload ~{Math.ceil((parsed.data.length * 3) / 4 / 1024)} KB
                </Badge>
              </div>

              {parsed.keyOrigin === "passphrase" ? (
                <div className="space-y-2">
                  <Label htmlFor="link-pp" className="text-xs">
                    Passphrase (shared by the sender out-of-band)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="link-pp"
                      type={passphraseVisible ? "text" : "password"}
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Passphrase"
                      className="font-mono text-sm"
                      autoComplete="off"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setPassphraseVisible((v) => !v)}
                      aria-label={passphraseVisible ? "Hide passphrase" : "Show passphrase"}
                    >
                      {passphraseVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                  <Button
                    onClick={handleDecrypt}
                    disabled={passphrase.length < 4 || busy}
                    className="w-full"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="size-4 animate-spin" /> Decrypting…
                      </>
                    ) : (
                      <>
                        <Lock className="size-3.5" /> Decrypt
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <Button onClick={handleDecrypt} disabled={busy} className="w-full">
                  {busy ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Decrypting…
                    </>
                  ) : (
                    <>
                      <Unlock className="size-3.5" /> Decrypt (key is in the link)
                    </>
                  )}
                </Button>
              )}

              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {error}
                </div>
              )}

              {result && (
                <div className="space-y-3">
                  {result.text ? (
                    <>
                      <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-words">
                        {result.text}
                      </pre>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard?.writeText(result.text ?? "");
                          toast.success("Copied to clipboard");
                        }}
                      >
                        <Copy className="size-3.5" /> Copy
                      </Button>
                    </>
                  ) : (
                    <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                      <Check className="size-5 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{result.fileName}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatBytesShort(result.size)} · {result.mime}
                        </div>
                      </div>
                      <a
                        href={result.blobUrl}
                        download={result.fileName ?? "aegis-file"}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        <Download className="size-3.5" /> Save
                      </a>
                    </div>
                  )}
                </div>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setParsed(null);
                  setResult(null);
                  setPassphrase("");
                  setInput("");
                }}
                className="w-full"
              >
                Load another link
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- shared ---------- */

function formatBytesShort(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
