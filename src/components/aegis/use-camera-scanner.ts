"use client";

import * as React from "react";
import jsQR from "jsqr";

export type ScanResult = {
  data: string;
  // location quad for drawing the highlight box, if desired
  location: { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomLeft: { x: number; y: number }; bottomRight: { x: number; y: number } };
};

type CameraState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "running"; track: MediaStreamTrack; stream: MediaStream }
  | { kind: "error"; message: string };

export function useCameraScanner(
  onResult: (r: ScanResult) => void,
  onError?: (msg: string) => void,
) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const [cameraState, setCameraState] = React.useState<CameraState>({ kind: "idle" });
  const [active, setActive] = React.useState(false);
  // throttle: only emit the same QR data once per ~250ms window
  const lastRef = React.useRef<{ data: string; ts: number } | null>(null);

  // Reset state on video element changes
  const stop = React.useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (cameraState.kind === "running") {
      cameraState.track.stop();
      cameraState.stream.getTracks().forEach((t) => t.stop());
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraState({ kind: "idle" });
    setActive(false);
  }, [cameraState]);

  const start = React.useCallback(async () => {
    if (cameraState.kind === "running" || cameraState.kind === "starting") return;
    setCameraState({ kind: "starting" });
    setActive(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API not available — use HTTPS or a modern browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const track = stream.getVideoTracks()[0];
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        setCameraState({ kind: "error", message: "Video element missing" });
        setActive(false);
        return;
      }
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play();
      setCameraState({ kind: "running", track, stream });

      // scan loop
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas 2d context unavailable");

      const tick = () => {
        if (!active && rafRef.current !== null) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA && cameraState.kind === "running") {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (w && h) {
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            const imgData = ctx.getImageData(0, 0, w, h);
            const code = jsQR(imgData.data, w, h, {
              inversionAttempts: "dontInvert",
            });
            if (code && code.data) {
              const now = performance.now();
              const last = lastRef.current;
              if (!last || last.data !== code.data || now - last.ts > 240) {
                lastRef.current = { data: code.data, ts: now };
                onResult({
                  data: code.data,
                  location: code.location,
                });
              }
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setCameraState({ kind: "error", message: msg });
      setActive(false);
      onError?.(msg);
    }
  }, [cameraState.kind]);

  // cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (cameraState.kind === "running") {
        cameraState.stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [cameraState]);

  return {
    videoRef,
    canvasRef,
    start,
    stop,
    cameraState,
    active,
  };
}
