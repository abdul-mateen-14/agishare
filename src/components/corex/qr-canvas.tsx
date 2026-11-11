"use client";

import * as React from "react";
import QRCode from "qrcode";

/**
 * Renders a single QR code from `value` into a <canvas> sized to `size`.
 * Picks the smallest QR version that fits and uses Q error correction so the
 * code stays scannable on screens with glare / partial occlusion.
 */
export function QrCanvas({
  value,
  size = 256,
  className,
  dark,
  light,
}: {
  value: string;
  size?: number;
  className?: string;
  dark?: string;
  light?: string;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!value) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    QRCode.toCanvas(canvas, value, {
      errorCorrectionLevel: "Q",
      margin: 2,
      width: size,
      color: {
        dark: dark ?? "#0a0f0e",
        light: light ?? "#ffffff",
      },
    })
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      });
    return () => {
      cancelled = true;
    };
  }, [value, size, dark, light]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }}
        aria-label="QR code"
      />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-destructive">
          QR too large: {error}
        </div>
      )}
    </div>
  );
}
