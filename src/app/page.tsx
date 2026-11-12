"use client";

import * as React from "react";
import { Header } from "@/components/aegis/header";
import { Footer } from "@/components/aegis/footer";
import { SendPanel, type SendMode } from "@/components/aegis/send-panel";
import { ReceivePanel, type ReceiveMode } from "@/components/aegis/receive-panel";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Lock,
  Camera,
  QrCode,
  KeyRound,
  ArrowRight,
  BookOpen,
  FileCheck,
  WifiOff,
  Eye,
  Cpu,
  Globe2,
  Link2,
  Wifi,
  Zap,
  Rocket,
} from "lucide-react";
import { BRAND } from "@/lib/brand";

/** Detect Aegis share-link fragments (#a1.…) so they can be auto-received. */
function useHashPayload(): [string | null, () => void] {
  const [hash, setHash] = React.useState<string | null>(null);
  React.useEffect(() => {
    const check = () => {
      const h = typeof window !== "undefined" ? window.location.hash : "";
      if (h.startsWith("#a1.")) setHash(h);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  const consume = React.useCallback(() => {
    if (typeof window !== "undefined" && window.location.hash.startsWith("#a1.")) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setHash(null);
  }, []);
  return [hash, consume];
}

export default function Home() {
  const [sendMode, setSendMode] = React.useState<SendMode>("qr");
  const [receiveMode, setReceiveMode] = React.useState<ReceiveMode>("qr");
  const [hashPayload, consumeHash] = useHashPayload();
  const [tab, setTab] = React.useState<string>("send");

  // opening a share link jumps straight to the receive tab
  React.useEffect(() => {
    if (hashPayload) setTab("receive");
  }, [hashPayload]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Hero onSend={() => setTab("send")} />
        <section className="mx-auto w-full max-w-6xl px-4 sm:px-6 pb-16">
          <Tabs value={tab} onValueChange={setTab} className="w-full">
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
                <BookOpen className="size-3.5" />
                How it works
              </TabsTrigger>
            </TabsList>
            <TabsContent value="send" className="mt-6">
              <SendPanel mode={sendMode} onModeChange={setSendMode} />
            </TabsContent>
            <TabsContent value="receive" className="mt-6">
              <ReceivePanel
                mode={receiveMode}
                onModeChange={setReceiveMode}
                hashPayload={hashPayload}
                onHashConsumed={consumeHash}
              />
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
function Hero({ onSend }: { onSend: () => void }) {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div className="aegis-grid-bg absolute inset-0 opacity-30" aria-hidden />
      <div
        className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background"
        aria-hidden
      />
      <div className="relative mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid items-center gap-10 md:grid-cols-[1.2fr_auto]">
          <div className="space-y-5">
            <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wider">
              <span className="size-1.5 rounded-full bg-primary animate-pulse" />
              serverless · encrypted · cross-device · edge-cached
            </Badge>
            <h1 className="aegis-text-balance text-3xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              <span className="text-2xl sm:text-4xl">{BRAND.name}</span>
              <span className="block text-primary mt-2 text-xl sm:text-2xl">
                Encrypted transfers — QR, links, P2P, or fast-fetch any URL.
              </span>
            </h1>
            <p className="text-pretty max-w-xl text-sm text-muted-foreground sm:text-base leading-relaxed">
              Four ways to move data without a server. Small files as animated
              QR codes or encrypted share links. Multi-GB files streaming
              device-to-device over WebRTC — the browser&apos;s AirDrop. Plus a
              Download Booster that fetches any public URL through
              Cloudflare&apos;s edge cache for instant downloads.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[11px]">
                <Lock className="mr-1 size-3" /> AES-GCM 256
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px]">
                <WifiOff className="mr-1 size-3" /> No server for transfers
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px]">
                <Globe2 className="mr-1 size-3" /> Any device
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px]">
                <Zap className="mr-1 size-3" /> GB-scale P2P
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px]">
                <Rocket className="mr-1 size-3" /> Edge-cached fetch
              </Badge>
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={onSend}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <ArrowRight className="size-4" /> Start sending
              </button>
              <a
                href="#how-it-works"
                onClick={(e) => {
                  e.preventDefault();
                  document.querySelector('[value="how"]')?.dispatchEvent(
                    new MouseEvent("click", { bubbles: true }),
                  );
                }}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                <BookOpen className="size-4" /> How it works
              </a>
            </div>
          </div>

          <div className="relative mx-auto hidden w-[280px] md:block">
            <HeroMock />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroMock() {
  return (
    <div className="relative space-y-3">
      <div className="rounded-2xl border border-primary/30 bg-card p-4 shadow-lg aegis-glow">
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
              />
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
          <span>aegis1{`{m:"D",i:3,n:12,…}`}</span>
          <span className="text-accent">▮▯▯▯</span>
        </div>
      </div>

      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-full border border-border bg-background px-2 py-1 text-[10px] font-mono text-muted-foreground">
        qr · link · p2p
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
  const methods = [
    {
      icon: QrCode,
      title: "QR codes — small files, phone-friendly",
      range: "up to ~1.5 MB",
      points: [
        "Payload encrypted with AES-GCM 256, sliced into ~850-byte chunks.",
        "Each chunk becomes a QR frame {index, total, session, sha-256, data} — the sender's screen cycles through them like a flipbook.",
        "The receiver's camera + jsQR accumulates frames in any order until all n arrive; hash verified, then decrypted.",
        "Keys travel as a separate Key QR (auto mode) or a passphrase you share out-of-band (PBKDF2 150k iterations).",
      ],
      best: "Phone ↔ anything. No camera on the sender? Use links or P2P.",
    },
    {
      icon: Link2,
      title: "Share links — small files, laptop-friendly",
      range: "up to ~90 KB per link",
      points: [
        "The encrypted payload lives in the URL fragment: aegishare.pages.dev/#a1.…",
        "Fragments never reach the server — Cloudflare Pages only sees a request for '/'. Zero server involvement, still works on static hosting.",
        "Passphrase mode: only the PBKDF2 salt rides in the link; the passphrase goes over a second channel. Auto mode: the key is in the link itself (whoever has the link can decrypt).",
        "Receiver opens the link, decryption happens instantly in their browser.",
      ],
      best: "Laptop ↔ laptop. Share via chat, email, whatever — no camera needed.",
    },
    {
      icon: Wifi,
      title: "Direct P2P — large files, Wi-Fi/LAN/internet",
      range: "MB to GB (memory-flat streaming)",
      points: [
        "WebRTC data channels carry the file bytes directly between the two browsers — no relay server, no upload/download.",
        "Signaling is the only handshake needed: the SDP offer/answer (~3 KB) travels as QR frames or a copy-paste code, whichever suits your devices.",
        "File is encrypted in 64 KB AES-GCM chunks (per-chunk IV = sessionId + chunk index) before touching the channel — WebRTC is just a tunnel for ciphertext.",
        "Backpressure-aware sender + chunk-by-chunk decryption keeps memory flat, so 4 GB works like 4 MB.",
        "Free public STUN servers assist NAT traversal; after that everything is direct P2P.",
      ],
      best: "Any two devices with browsers. The fast lane for real files.",
    },
    {
      icon: Rocket,
      title: "Download Booster — fast-fetch any URL",
      range: "anything public · edge-cached",
      points: [
        "Paste a public URL (GitHub release, ISO mirror, slow CDN) and Aegis fetches it through a Cloudflare Pages Function at the edge.",
        "The worker uses HTTP/2 multiplexing + warm TLS to popular origins, caches the body in the Cloudflare Cache API, and streams it to you at full link speed.",
        "Subsequent downloads of the same URL hit the edge cache — instant. Great for files that everyone in the room needs to grab.",
        "Range requests are forwarded transparently so resuming partial downloads works. Optional HMAC signing (set AEGIS_BOOSTER_SECRET) stops strangers using your deployment as an open proxy.",
        "Privacy: the worker doesn't log or inspect bytes. For sensitive URLs use Link / P2P / QR instead — those keep bytes off any intermediary. Booster is for public files.",
      ],
      best: "Slow GitHub releases, throttled CDNs, public datasets — get them at your link speed, not the origin's.",
    },
  ];

  const steps = [
    {
      icon: Lock,
      n: 1,
      title: "Encrypt locally",
      body: "Everything is encrypted in your browser with the Web Crypto API (AES-GCM 256). Keys never leave the device unencrypted — not even the P2P handshake carries plaintext.",
    },
    {
      icon: KeyRound,
      n: 2,
      title: "Share the key out-of-band",
      body: "Passphrase mode derives the AES key via PBKDF2-SHA256 (150k iterations, random salt). Auto mode mints a random 256-bit key you scan or paste once.",
    },
    {
      icon: Eye,
      n: 3,
      title: "Move data over the side channel",
      body: "QR frames, URL fragments, or WebRTC signaling codes — pick whatever the two devices can do. The bulk transfer itself is always direct: screen-to-camera, link-click, or peer-to-peer socket.",
    },
    {
      icon: FileCheck,
      n: 4,
      title: "Verify and decrypt on the receiver",
      body: "Hash checks on QR mode, GCM auth tags everywhere else. The receiver decrypts locally — plaintext never exists on any server, because there isn't one.",
    },
  ];

  return (
    <div className="space-y-6" id="how-it-works">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          How {BRAND.name} works
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          A truly serverless transfer suite. Pick the method that fits your
          devices — all three run entirely client-side and deploy as static
          files on Cloudflare Pages.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {methods.map((m) => (
          <Card key={m.title} className="relative overflow-hidden">
            <CardHeader>
              <div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <m.icon className="size-5" />
              </div>
              <CardTitle className="text-base leading-snug">{m.title}</CardTitle>
              <Badge variant="secondary" className="font-mono text-[10px] w-fit">
                {m.range}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-1.5 text-sm text-muted-foreground leading-relaxed">
                {m.points.map((p, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                    {p}
                  </li>
                ))}
              </ul>
              <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                <b className="text-foreground">Best for:</b> {m.best}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <Card key={s.n} className="relative overflow-hidden">
            <div className="pointer-events-none absolute -right-2 -top-3 text-6xl font-bold text-primary/10 select-none">
              {s.n}
            </div>
            <CardHeader>
              <div className="mb-1 inline-flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <s.icon className="size-4" />
              </div>
              <CardTitle className="text-sm">{s.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.body}</p>
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
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <div className="space-y-1.5">
            <div className="font-medium">QR speed</div>
            <p className="text-muted-foreground">
              Keep the sender at 200–400 ms per frame; crank screen brightness.
              ~130 frames ≈ 100 KB in under 30 seconds.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="font-medium">Link length</div>
            <p className="text-muted-foreground">
              Links under ~4,000 chars paste cleanly into any chat app. Longer
              links still work in email/Telegram — watch the char counter.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="font-medium">P2P networks</div>
            <p className="text-muted-foreground">
              Same Wi-Fi = fastest. Across the internet, throughput follows
              your upload bandwidth. Symmetric-NAT networks may block direct
              P2P (no TURN relay is used).
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="font-medium">Same-device demo</div>
            <p className="text-muted-foreground">
              Open two browser windows: Send in one, Receive in the other, and
              copy-paste the codes between them.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
