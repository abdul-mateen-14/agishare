"use client";

import * as React from "react";
import { Header } from "@/components/corex/header";
import { Footer } from "@/components/corex/footer";
import { SendPanel } from "@/components/corex/send-panel";
import { ReceivePanel } from "@/components/corex/receive-panel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Lock,
  Camera,
  QrCode,
  KeyRound,
  ArrowRight,
  ShieldCheck,
  WifiOff,
  Eye,
  Cpu,
  Globe2,
  FileText,
  Zap,
} from "lucide-react";
import { BRAND } from "@/lib/brand";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <section className="mx-auto w-full max-w-6xl px-4 sm:px-6 pb-16">
          <Tabs defaultValue="send" className="w-full">
            <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-3">
              <TabsTrigger value="send" className="py-2.5">
                <ArrowRight className="size-3.5" />
                Send
              </TabsTrigger>
              <TabsTrigger value="receive" className="py-2.5">
                <Camera className="size-3.5" />
                Receive
              </TabsTrigger>
              <TabsTrigger value="how" className="col-span-2 py-2.5 sm:col-span-1">
                <ShieldCheck className="size-3.5" />
                How it works
              </TabsTrigger>
            </TabsList>
            <TabsContent value="send" className="mt-6">
              <SendPanel />
            </TabsContent>
            <TabsContent value="receive" className="mt-6">
              <ReceivePanel />
            </TabsContent>
            <TabsContent value="how" className="mt-6">
              <HowItWorks />
            </TabsContent>
          </Tabs>
        </section>
      </main>
      <Footer />
    </div>
  );
}

/* =====================================================
   Hero
   ==================================================== */
function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      {/* QR-grid background */}
      <div className="corex-grid-bg absolute inset-0 opacity-30" aria-hidden />
      <div
        className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background"
        aria-hidden
      />
      <div className="relative mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid items-center gap-10 md:grid-cols-[1.2fr_auto]">
          <div className="space-y-5">
            <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wider">
              <span className="size-1.5 rounded-full bg-primary animate-pulse" />
              serverless · encrypted · cross-device
            </Badge>
            <h1 className="text-balance text-3xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              <span className="font-mono tracking-[0.18em]">{BRAND.name}</span>
              <span className="block text-primary mt-2 text-2xl sm:text-3xl">
                Encrypted transfers via QR codes.
              </span>
            </h1>
            <p className="text-pretty max-w-xl text-sm text-muted-foreground sm:text-base leading-relaxed">
              {BRAND.description} No servers, no accounts, no internet — just
              a screen, a camera, and end-to-end AES-GCM 256 encryption.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[11px]">
                <Lock className="mr-1 size-3" /> AES-GCM 256
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px]">
                <WifiOff className="mr-1 size-3" /> No server
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px]">
                <Globe2 className="mr-1 size-3" /> Any device
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px]">
                <Cpu className="mr-1 size-3" /> Web Crypto
              </Badge>
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
              <a
                href="#send"
                onClick={(e) => {
                  e.preventDefault();
                  document.querySelector('[data-value="send"]')?.dispatchEvent(
                    new MouseEvent("click", { bubbles: true }),
                  );
                }}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <ArrowRight className="size-4" /> Start sending
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                <ShieldCheck className="size-4" /> How it works
              </a>
            </div>
          </div>

          {/* Visual mock */}
          <div className="relative mx-auto hidden w-[280px] md:block">
            <HeroMock />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroMock() {
  // Tiny decorative QR mock — two halves (sender + receiver) meeting
  return (
    <div className="relative space-y-3">
      <div className="rounded-2xl border border-primary/30 bg-card p-4 shadow-lg corex-glow">
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          <span>sender</span>
          <span className="text-primary">broadcasting</span>
        </div>
        <div className="mt-3 grid grid-cols-12 gap-0.5">
          {Array.from({ length: 144 }).map((_, i) => {
            const on =
              (i * 7) % 5 === 0 ||
              (i % 13 === 0) ||
              (i > 60 && i < 84 && i % 3 === 0);
            return (
              <div
                key={i}
                className={`aspect-square rounded-[1px] ${
                  on ? "bg-primary" : "bg-primary/10"
                }`}
                style={{
                  animationDelay: `${i * 4}ms`,
                }}
              />
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
          <span>corex1{`{m:"D",i:3,n:12,…}`}</span>
          <span className="text-accent">▮▯▯▯</span>
        </div>
      </div>

      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background px-2 py-1 text-[10px] font-mono text-muted-foreground">
        camera scan
      </div>

      <div className="ml-auto w-[80%] rounded-2xl border border-accent/30 bg-card p-3 shadow">
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          <span>receiver</span>
          <span className="text-accent">decrypted ✓</span>
        </div>
        <div className="mt-2 space-y-1">
          <div className="h-2 w-3/4 rounded bg-foreground/80" />
          <div className="h-2 w-1/2 rounded bg-foreground/60" />
          <div className="h-2 w-2/3 rounded bg-foreground/40" />
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[10px] font-mono text-primary">
          <Lock className="size-3" /> aes-gcm 256
        </div>
      </div>
    </div>
  );
}

/* =====================================================
   How it works
   ==================================================== */
function HowItWorks() {
  const steps = [
    {
      icon: Lock,
      n: 1,
      title: "Encrypt locally",
      body: "You paste text or drop a file. COREX encrypts it in your browser using AES-GCM 256-bit with the Web Crypto API. The key never leaves your device unencrypted.",
    },
    {
      icon: QrCode,
      n: 2,
      title: "Slice into QR frames",
      body: "The encrypted blob is split into ~1 KB chunks. Each chunk gets a header with its index, total, session id and SHA-256 hash, then rendered as a QR code.",
    },
    {
      icon: Eye,
      n: 3,
      title: "Broadcast visually",
      body: "Your screen cycles through the QR frames at ~5 fps. The receiver's camera sees them — no network, no Bluetooth, no WebRTC, no relay server.",
    },
    {
      icon: KeyRound,
      n: 4,
      title: "Share the key out-of-band",
      body: "Either type a passphrase (PBKDF2-derived) or let COREX generate a random key shown as a separate Key QR. The receiver scans it first, or pastes the key.",
    },
    {
      icon: Camera,
      n: 5,
      title: "Reassemble + verify",
      body: "The receiver accumulates chunks by session id. Once all n are present, COREX verifies the SHA-256 hash matches the frame header, then reassembles.",
    },
    {
      icon: ShieldCheck,
      n: 6,
      title: "Decrypt on the receiver",
      body: "The receiver's browser derives the same key from the passphrase + salt, or uses the pasted/scanned key, and runs AES-GCM decryption. The plaintext is shown or downloaded.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          How COREX works
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          A truly serverless data transfer protocol. Everything happens in
          your browser; data moves over the air as QR codes; encryption keys
          never touch a server.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {steps.map((s) => (
          <Card key={s.n} className="relative overflow-hidden">
            <div className="pointer-events-none absolute -right-4 -top-4 text-7xl font-bold text-primary/10 select-none">
              {s.n}
            </div>
            <CardHeader>
              <div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <s.icon className="size-5" />
              </div>
              <CardTitle className="text-base">{s.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {s.body}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="size-4 text-accent" />
            Practical tips
          </CardTitle>
          <CardDescription>
            How to get reliable transfers in the real world.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <div className="space-y-1.5">
            <div className="font-medium text-foreground">Frame dwell time</div>
            <p className="text-muted-foreground">
              Lower-end phones can&apos;t scan faster than ~5 fps. Keep the
              sender at 200&ndash;400 ms per frame for reliable transfer.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="font-medium text-foreground">Screen brightness</div>
            <p className="text-muted-foreground">
              Crank the sender&apos;s screen to maximum brightness. Camera
              exposure adapts to bright screens far better than dim ones.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="font-medium text-foreground">Distance</div>
            <p className="text-muted-foreground">
              10&ndash;25 cm between the receiver&apos;s camera and the
              sender&apos;s screen is the sweet spot for QR readability.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="font-medium text-foreground">Size limits</div>
            <p className="text-muted-foreground">
              We cap payloads at ~1.5 MB. A 100 KB file is roughly 130 frames
              and scans in under 30 seconds.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="font-medium text-foreground">Use passphrase mode for sensitive data</div>
            <p className="text-muted-foreground">
              Auto-key mode is convenient but anyone who can scan your screen
              captures the key. For passwords or secrets, use passphrase mode.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="font-medium text-foreground">Demo on one device</div>
            <p className="text-muted-foreground">
              Open COREX in two browser windows (or two tabs), put Send on one
              and Receive on the other, and point your phone&apos;s camera at
              the screen — or vice versa.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4" />
            Protocol reference
          </CardTitle>
          <CardDescription>
            What actually travels over the air.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Every QR frame starts with the magic prefix{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">COREX1</code>{" "}
            so the receiver ignores non-COREX QR codes (event tickets, URLs,
            restaurant menus, …).
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs font-mono font-bold uppercase tracking-wider text-primary">
                Key frame
              </div>
              <pre className="mt-2 overflow-x-auto text-[11px] font-mono leading-relaxed">
{`COREX1{
  "m":"K",
  "o":"auto"|"passphrase",
  "k":"<base64 raw key>",   // auto only
  "s":"<base64 salt>"      // passphrase only
}`}
              </pre>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs font-mono font-bold uppercase tracking-wider text-primary">
                Data frame
              </div>
              <pre className="mt-2 overflow-x-auto text-[11px] font-mono leading-relaxed">
{`COREX1{
  "m":"D",
  "i":<chunk index 0..n-1>,
  "n":<total chunks>,
  "s":"<session id>",
  "h":"<sha256 hex of iv||ct>",
  "d":"<base64 chunk>"
}`}
              </pre>
            </div>
          </div>
          <p className="text-muted-foreground">
            The encrypted payload itself is{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              iv (12 B) || ciphertext+authTag
            </code>{" "}
            produced by AES-GCM 256. The IV travels inside chunk 0, so no
            separate IV channel is required.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
