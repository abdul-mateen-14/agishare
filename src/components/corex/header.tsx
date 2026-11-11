"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldCheck, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { BRAND } from "@/lib/brand";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-3">
          <span className="relative inline-flex size-9 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/30">
            {/* Inline logo so we can theme it */}
            <svg
              viewBox="0 0 64 64"
              className="size-6"
              fill="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="cx-hdr" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                  <stop stopColor="var(--primary)" />
                  <stop offset="1" stopColor="var(--accent)" />
                </linearGradient>
              </defs>
              <path
                d="M32 2 L58 16 V48 L32 62 L6 48 V16 Z"
                fill="none"
                stroke="url(#cx-hdr)"
                strokeWidth="3.5"
                strokeLinejoin="round"
              />
              <g fill="url(#cx-hdr)">
                <rect x="20" y="20" width="6" height="6" rx="1" />
                <rect x="38" y="20" width="6" height="6" rx="1" />
                <rect x="20" y="38" width="6" height="6" rx="1" />
                <rect x="32" y="32" width="6" height="6" rx="1" />
              </g>
            </svg>
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-mono text-base font-bold tracking-[0.22em]">
              {BRAND.name}
            </span>
            <span className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              {BRAND.domain}
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => {
              const el = document.getElementById("how-it-works");
              el?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            <ShieldCheck className="size-4" />
            How it works
          </Button>
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="hidden sm:inline-flex"
          >
            <a
              href="https://corex.site.je"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="COREX site"
            >
              <Github className="size-4" />
            </a>
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
