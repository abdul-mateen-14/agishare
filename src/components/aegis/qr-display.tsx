"use client";

import * as React from "react";
import { useSendStore } from "@/lib/store";
import { QrCanvas } from "./qr-canvas";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Pause, Play, RotateCcw, KeyRound, ArrowRight } from "lucide-react";
import { PROTOCOL } from "@/lib/brand";

/**
 * Sender — animated QR broadcast.
 *
 * Cycles through the KEY frame (if any) + all DATA frames forever. A timer
 * advances the cursor every `frameMs` milliseconds. The progress bar reflects
 * position within the current full sweep.
 */
export function QrDisplay() {
  const {
    keyFrame,
    dataFrames,
    cursor,
    loops,
    frameMs,
    totalChunks,
    sessionId,
    status,
    setSend,
    reset,
    rawKeyB64,
    keyOrigin,
    previewText,
  } = useSendStore();

  // full ordered frame list: KEY (if any) first, then DATA 0..n-1
  const allFrames = React.useMemo(() => {
    const out: string[] = [];
    if (keyFrame) out.push(keyFrame);
    out.push(...dataFrames);
    return out;
  }, [keyFrame, dataFrames]);

  // start/stop animation
  React.useEffect(() => {
    if (status !== "broadcasting" || allFrames.length === 0) return;
    const id = window.setInterval(() => {
      const cur = useSendStore.getState().cursor;
      const next = cur + 1;
      if (next >= allFrames.length) {
        setSend({ cursor: 0, loops: useSendStore.getState().loops + 1 });
      } else {
        setSend({ cursor: next });
      }
    }, Math.max(60, frameMs));
    return () => window.clearInterval(id);
  }, [status, allFrames.length, frameMs, setSend]);

  const isKeyFrame = keyFrame && cursor === 0;
  const currentFrame = allFrames[cursor] ?? "";

  if (status === "idle" || allFrames.length === 0) {
    return (
      <div className="flex aspect-square w-full max-w-[320px] items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center">
        <div className="space-y-1">
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            QR stream
          </div>
          <div className="text-sm text-muted-foreground">
            Enter your message and press Generate to start broadcasting.
          </div>
        </div>
      </div>
    );
  }

  const frameSize = 320;
  const sweepPos = (cursor / Math.max(1, allFrames.length)) * 100;

  return (
    <div className="space-y-4">
      {/* Big QR */}
      <div className="relative mx-auto w-full max-w-[320px]">
        <div
          className={`relative overflow-hidden rounded-2xl bg-white p-3 shadow-lg ring-1 ring-primary/20 ${
            status === "broadcasting" ? "aegis-scan-pulse" : ""
          }`}
        >
          <QrCanvas value={currentFrame} size={frameSize} className="size-full" />
          {/* corner accents */}
          <CornerAccents />
          {/* sweep scanline while broadcasting */}
          {status === "broadcasting" && (
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 right-0 h-px bg-primary/70"
              style={{ top: `${sweepPos}%` }}
            />
          )}
        </div>
        {/* frame label */}
        <div className="mt-3 flex items-center justify-between">
          <Badge variant={isKeyFrame ? "secondary" : "default"} className="font-mono text-[10px]">
            {isKeyFrame ? "KEY" : `DATA ${cursor - (keyFrame ? 1 : 0) + 1}/${totalChunks}`}
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">
            session {sessionId || "—"}
          </span>
        </div>
      </div>

      {/* progress + controls */}
      <div className="space-y-2">
        <Progress value={sweepPos} className="h-1.5" />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {cursor + 1} / {allFrames.length} frame
          </span>
          <span>loop #{loops}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {status === "broadcasting" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSend({ status: "ready", cursor: 0 })}
          >
            <Pause className="size-3.5" /> Pause
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => setSend({ status: "broadcasting", cursor: 0 })}
          >
            <Play className="size-3.5" /> Broadcast
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setSend({ cursor: 0, loops: 0 })}>
          <RotateCcw className="size-3.5" /> Restart
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>
          Clear
        </Button>
      </div>

      {/* Key QR (auto mode) — show in a separate card so receiver scans it first */}
      {keyOrigin === "auto" && rawKeyB64 && (
        <div className="mt-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <KeyRound className="size-3.5 text-primary" />
            Step 1 — Receiver scans this Key QR first
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="size-20 shrink-0 overflow-hidden rounded bg-white p-1">
              <QrCanvas
                value={keyFrame ?? ""}
                size={72}
                className="size-full"
              />
            </div>
            <div className="min-w-0 space-y-1 text-[11px]">
              <div className="font-mono break-all text-muted-foreground">
                {rawKeyB64}
              </div>
              <p className="text-muted-foreground/80">
                Or share this string out-of-band (e.g. SMS, voice) and the
                receiver pastes it under Receive.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Passphrase-mode reminder */}
      {keyOrigin === "passphrase" && previewText && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 p-3 text-xs">
          <div className="flex items-center gap-2 font-semibold">
            <ArrowRight className="size-3.5 text-accent" />
            Receiver must type the same passphrase.
          </div>
          <p className="mt-1 text-muted-foreground">
            Salt travels inside each DATA frame so the receiver doesn&apos;t need
            anything else from you.
          </p>
        </div>
      )}

      {/* Frame timing */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/80 font-mono">
        <span>
          frame {frameMs}ms · chunk {PROTOCOL.chunkBytes}B
        </span>
        <span>{allFrames.length} frames total</span>
      </div>
    </div>
  );
}

function CornerAccents() {
  const base =
    "absolute size-5 border-primary pointer-events-none";
  return (
    <>
      <span className={`${base} left-1 top-1 border-l-2 border-t-2 rounded-tl`} />
      <span className={`${base} right-1 top-1 border-r-2 border-t-2 rounded-tr`} />
      <span className={`${base} left-1 bottom-1 border-l-2 border-b-2 rounded-bl`} />
      <span className={`${base} right-1 bottom-1 border-r-2 border-b-2 rounded-br`} />
    </>
  );
}
