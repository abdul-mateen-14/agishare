"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { BRAND } from "@/lib/brand";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex flex-col leading-none">
            <span className="text-base font-bold tracking-tight">
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
            <BookOpen className="size-4" />
            How it works
          </Button>
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="hidden sm:inline-flex"
          >
            <a
              href={`https://${BRAND.domain}`}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Aegis Share site"
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
