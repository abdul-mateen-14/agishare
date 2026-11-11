"use client";

import * as React from "react";
import { QrSendPanel } from "./qr-send-mode";
import { LinkSendPanel } from "./link-panel";
import { P2pSendPanel } from "./p2p-send-panel";
import { BoosterPanel } from "./booster-panel";
import { QrCode, Link2, Wifi, Rocket } from "lucide-react";

export type SendMode = "qr" | "link" | "p2p" | "booster";

export function SendPanel({
  mode,
  onModeChange,
}: {
  mode: SendMode;
  onModeChange: (m: SendMode) => void;
}) {
  const modes: { id: SendMode; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "qr", label: "QR codes", hint: "phones · up to 1.5 MB", icon: QrCode },
    { id: "link", label: "Share link", hint: "laptops · small files", icon: Link2 },
    { id: "p2p", label: "Direct P2P", hint: "Wi-Fi/LAN · GB-scale", icon: Wifi },
    { id: "booster", label: "Booster", hint: "fast fetch any URL", icon: Rocket },
  ];

  return (
    <div className="space-y-5">
      {/* mode selector */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="tablist" aria-label="Send mode">
        {modes.map((m) => {
          const active = mode === m.id;
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              role="tab"
              aria-selected={active}
              onClick={() => onModeChange(m.id)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-center transition ${
                active
                  ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/40"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              <Icon className={`size-5 ${active ? "text-primary" : ""}`} />
              <span className="text-sm font-medium leading-none">{m.label}</span>
              <span className="text-[10px] leading-none opacity-70">{m.hint}</span>
            </button>
          );
        })}
      </div>

      {mode === "qr" && <QrSendPanel />}
      {mode === "link" && <LinkSendPanel />}
      {mode === "p2p" && <P2pSendPanel />}
      {mode === "booster" && <BoosterPanel />}
    </div>
  );
}
