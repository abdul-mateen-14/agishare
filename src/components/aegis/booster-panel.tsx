"use client";

import * as React from "react";
import {
  downloadBoosted,
  probeUrl,
  isProbablyPublicUrl,
  guessFilename,
  formatBytes,
  formatSpeed,
  formatEta,
  estimateEta,
  type BoosterMeta,
  type BoosterProgress,
} from "@/lib/booster";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Rocket,
  Loader2,
  CheckCircle2,
  XCircle,
  Database,
  Zap,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

type Phase = "idle" | "probing" | "ready" | "downloading" | "done" | "error";

export function BoosterPanel() {
  const [url, setUrl] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [meta, setMeta] = React.useState<BoosterMeta | null>(null);
  const [progress, setProgress] = React.useState<BoosterProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [savedName, setSavedName] = React.useState<string>("");
  const [showHowItWorks, setShowHowItWorks] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const urlOk = React.useMemo(() => isProbablyPublicUrl(url.trim()), [url]);

  async function handleProbe() {
    if (!urlOk.ok) {
      setError(urlOk.reason ?? "Invalid URL");
      setPhase("error");
      return;
    }
    setPhase("probing");
    setError(null);
    setMeta(null);
    setBlobUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setProgress(null);
    try {
      const m = await probeUrl(url.trim());
      setMeta(m);
      setPhase("ready");
      toast.success(
        m.cached ? "Edge cache hit — download will be instant!" : "Probe OK — ready to fetch",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  async function handleDownload() {
    if (!meta) return;
    setPhase("downloading");
    setError(null);
    setProgress(null);
    setBlobUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const { blob, meta: m } = await downloadBoosted(
        url.trim(),
        (p) => setProgress(p),
        ac.signal,
      );
      const u = URL.createObjectURL(blob);
      setBlobUrl(u);
      setSavedName(m.filename || guessFilename(url.trim()));
      setPhase("done");
      toast.success(`Downloaded ${formatBytes(blob.size)} via Aegis edge`);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setPhase("ready");
        toast("Download cancelled");
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  function handleReset() {
    abortRef.current?.abort();
    setPhase("idle");
    setUrl("");
    setMeta(null);
    setProgress(null);
    setError(null);
    setBlobUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setSavedName("");
  }

  const eta = progress
    ? estimateEta(progress.bytesReceived, progress.totalBytes, progress.speedBps)
    : null;

  return (
    <div className="space-y-4 min-w-0">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Rocket className="size-4" />
            </span>
            Download Booster
          </CardTitle>
          <CardDescription>
            Paste any public URL — a GitHub release, an ISO mirror, a slow CDN —
            and Aegis fetches it through Cloudflare&apos;s edge network (HTTP/2,
            warm TLS, edge cache) and streams it back to you at full speed.
            Subsequent downloads of the same URL are instant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* input row */}
          <div className="space-y-2">
            <Label htmlFor="booster-url" className="text-xs">
              URL to download
            </Label>
            <Input
              id="booster-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/user/repo/releases/download/v1/file.zip"
              className="font-mono text-xs"
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter" && phase !== "probing") {
                  e.preventDefault();
                  handleProbe();
                }
              }}
            />
            {url && !urlOk.ok && phase !== "downloading" && (
              <p className="text-[11px] text-destructive">{urlOk.reason}</p>
            )}
          </div>

          {/* action row */}
          <div className="flex flex-wrap gap-2">
            {phase === "idle" || phase === "error" ? (
              <Button onClick={handleProbe} disabled={!urlOk.ok || !url.trim()}>
                <ArrowRight className="size-3.5" /> Probe URL
              </Button>
            ) : (
              <Button variant="outline" onClick={handleReset} disabled={phase === "downloading"}>
                Reset
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHowItWorks((v) => !v)}
            >
              {showHowItWorks ? "Hide details" : "Why is this fast?"}
            </Button>
          </div>

          {showHowItWorks && <HowItWorksBox />}

          {/* probe state */}
          {phase === "probing" && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Probing the URL via Cloudflare edge…
            </div>
          )}

          {/* meta */}
          {meta && (phase === "ready" || phase === "downloading" || phase === "done") && (
            <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="truncate font-mono text-sm font-medium">
                    {meta.filename}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{formatBytes(meta.size)}</span>
                    <span>·</span>
                    <span className="truncate max-w-[280px]">{meta.mime}</span>
                    {meta.cached && (
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        <Database className="mr-1 size-3" /> edge-cached
                      </Badge>
                    )}
                  </div>
                </div>
                <a
                  href={meta.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
                >
                  <ExternalLink className="size-3" /> source
                </a>
              </div>
            </div>
          )}

          {/* download controls */}
          {phase === "ready" && (
            <Button onClick={handleDownload} size="lg" className="w-full">
              <Download className="size-4" /> Download via Aegis edge
            </Button>
          )}

          {/* progress */}
          {phase === "downloading" && progress && (
            <div className="space-y-3">
              <Progress value={progress.percent > 0 ? progress.percent : 0} className="h-2.5" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <Stat
                  label="Received"
                  value={formatBytes(progress.bytesReceived)}
                />
                <Stat
                  label="Total"
                  value={progress.totalBytes > 0 ? formatBytes(progress.totalBytes) : "—"}
                />
                <Stat label="Speed" value={formatSpeed(progress.speedBps)} />
                <Stat label="ETA" value={formatEta(eta)} />
              </div>
              <Button variant="outline" size="sm" onClick={handleCancel} className="w-full">
                <XCircle className="size-3.5" /> Cancel
              </Button>
            </div>
          )}

          {/* done */}
          {phase === "done" && blobUrl && (
            <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <CheckCircle2 className="size-6 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{savedName}</div>
                <div className="text-[11px] text-muted-foreground">
                  {progress && formatBytes(progress.bytesReceived)} ·{" "}
                  {progress && formatSpeed(progress.speedBps)} avg
                </div>
              </div>
              <a
                href={blobUrl}
                download={savedName}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 shrink-0"
              >
                <Download className="size-4" /> Save file
              </a>
            </div>
          )}

          {error && phase === "error" && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <XCircle className="size-3.5" /> Failed
              </div>
              <div className="font-mono break-words">{error}</div>
              <p className="text-muted-foreground">
                Note: the edge worker runs on Cloudflare Pages Functions. In
                the local dev server it isn&apos;t active — try it on the
                deployed site at aegishare.pages.dev.
              </p>
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

function HowItWorksBox() {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Zap className="size-4 text-primary" />
        Why Aegis&apos;s proxy is faster than a direct download
      </div>
      <ul className="space-y-2 text-muted-foreground text-xs leading-relaxed">
        <li className="flex gap-2">
          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
          <span>
            <b className="text-foreground">HTTP/2 multiplexing.</b> The origin
            server may serve you over a single slow connection. Cloudflare&apos;s
            edge workers keep warm HTTP/2 sessions to popular origins and fetch
            in parallel streams when the source supports range requests.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
          <span>
            <b className="text-foreground">Edge caching.</b> The first download
            populates a Cloudflare Cache API entry at the edge; everyone (and
            your re-downloads) gets instant bytes from there. Great for GitHub
            release assets that are downloaded many times.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
          <span>
            <b className="text-foreground">Closer to you.</b> Cloudflare&apos;s
            300+ datacenters terminate TLS near you; even if the origin is on
            the other side of the planet, your download runs at your link speed
            to Cloudflare, not the origin&apos;s speed to you.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
          <span>
            <b className="text-foreground">No throttling.</b> Some CDNs throttle
            per-IP per-connection. The edge fetches from a Cloudflare IP, then
            streams to you at full link speed — bypassing per-user throttles.
          </span>
        </li>
      </ul>
      <p className="text-[11px] text-muted-foreground/80 border-t border-border pt-2">
        Caveats: the worker runs on Cloudflare Pages Functions, which cap
        responses at ~100 MB per request on the free plan (we chunk by range
        under the hood where supported). For larger files, the cached entry
        still helps subsequent downloads. Set{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono">AEGIS_BOOSTER_SECRET</code>{" "}
        env var on your deployment to require an HMAC signature and stop
        strangers using your proxy.
      </p>
    </div>
  );
}
