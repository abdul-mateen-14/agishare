"use client";

import * as React from "react";
import { Lock, WifiOff, Github, Zap } from "lucide-react";
import { BRAND } from "@/lib/brand";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-card/40">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <div className="text-base font-bold tracking-tight">
              {BRAND.name}
            </div>
            <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
              {BRAND.description}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Why it&apos;s safe
            </div>
            <ul className="space-y-1.5 text-xs">
              <li className="flex items-center gap-2">
                <WifiOff className="size-3.5 text-primary" />
                No server. No relay. No WebRTC signaling broker.
              </li>
              <li className="flex items-center gap-2">
                <Lock className="size-3.5 text-primary" />
                AES-GCM 256-bit, encrypted in your browser.
              </li>
              <li className="flex items-center gap-2">
                <Zap className="size-3.5 text-primary" />
                GB-scale files stream over WebRTC data channels.
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {BRAND.domain}
            </div>
            <div className="text-xs text-muted-foreground">
              v{BRAND.version} · {new Date().getFullYear()}
            </div>
            <a
              href={`https://${BRAND.domain}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-xs hover:text-primary"
            >
              <Github className="size-3.5" />
              {BRAND.domain}
            </a>
          </div>
        </div>

        <div className="mt-6 border-t border-border/40 pt-4 text-[10px] text-muted-foreground/80">
          <span className="font-mono">
            © {new Date().getFullYear()} {BRAND.name}. Open-source, MIT-licensed. Use responsibly.
          </span>
        </div>
      </div>
    </footer>
  );
}
