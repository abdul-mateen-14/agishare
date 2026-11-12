"use client";

import * as React from "react";
import { QrReceivePanel } from "./qr-receive-mode";
import { LinkReceivePanel } from "./link-panel";
import { P2pReceivePanel } from "./p2p-receive-panel";
import { QrCode, Link2, Wifi } from "lucide-react";

export type ReceiveMode = "qr" | "link" | "p2p";

export function ReceivePanel({
  mode,
  onModeChange,
  hashPayload,
  onHashConsumed,
}: {
  mode: ReceiveMode;
  onModeChange: (m: ReceiveMode) => void;
  /** raw URL hash if the page was opened with #a1.… — switches to link mode */
  hashPayload: string | null;
  onHashConsumed: () => void;
}) {
  // auto-switch to link mode when a share link is opened
  React.useEffect(() => {
    if (hashPayload) onModeChange("link");
  }, [hashPayload]);

  const modes: { id: ReceiveMode; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "qr", label: "QR scan", hint: "phones · camera", icon: QrCode },
    { id: "link", label: "Open link", hint: "laptops · paste URL", icon: Link2 },
    { id: "p2p", label: "Direct P2P", hint: "Wi-Fi/LAN · GB-scale", icon: Wifi },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Receive mode">
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

      {mode === "qr" && <QrReceivePanel />}
      {mode === "link" && (
        <LinkReceivePanel initialPayload={hashPayload} onConsumed={onHashConsumed} />
      )}
      {mode === "p2p" && <P2pReceivePanel />}
    </div>
  );
}
