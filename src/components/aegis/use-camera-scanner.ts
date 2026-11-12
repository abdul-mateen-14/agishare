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
  | { kind: "error"; message: string; reason?: CameraErrorReason };

export type CameraErrorReason =
  | "permission_denied"
  | "no_camera"
  | "in_use"
  | "not_supported"
  | "unknown";

/**
 * Translate a browser getUserMedia error into an actionable, human message
 * plus a stable reason code the UI can branch on (e.g. show a "use paste-key
 * instead" fallback button when the camera is unavailable).
 *
 * Browsers throw DOMException with these .name values:
 *   NotAllowedError       — user denied camera permission (or it was revoked)
 *   NotFoundError         — no camera hardware matches the constraints
 *   NotReadableError      — camera is in use by another app (Zoom/Teams/etc)
 *   OverconstrainedError  — facingMode:'environment' unsupported (laptops)
 *   SecurityError         — non-HTTPS context (camera needs HTTPS)
 *   AbortError            — interrupted; usually transient
 */
export function humanizeCameraError(e: unknown): { message: string; reason: CameraErrorReason } {
  const name = (e as any)?.name as string | undefined;
  const raw = e instanceof Error ? e.message : String(e);
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        reason: "permission_denied",
        message:
          "Camera permission was denied. Click the camera icon in your browser's address bar, choose 'Allow', then press Start again.",
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return {
        reason: "no_camera",
        message:
          "No camera found that matches the requested mode. If your laptop has no webcam (or only a virtual one), use the paste-key path instead — see the Key panel below.",
      };
    case "NotReadableError":
      return {
        reason: "in_use",
        message:
          "Camera is in use by another app (Zoom, Teams, Meet, OBS, etc). Close it and press Start again.",
      };
    case "AbortError":
      return {
        reason: "unknown",
        message: "Camera request was interrupted. Press Start to try again.",
      };
    default:
      return {
        reason: "unknown",
        message: `Camera error: ${raw || "unknown"}`,
      };
  }
}

/**
 * Camera + jsQR scanning hook.
 *
 * IMPORTANT: the per-frame scan loop (`tick`) must read live state, not
 * closure-captured state. React's `useCallback` closes over the values from
 * the render where the callback was last memoized — so `active` and
 * `cameraState.kind` captured at the start of `start()` would still be
 * their pre-start values (`false` / `"idle"`) by the time `tick` runs,
 * causing the loop to bail out on frame 1 and never decode a single QR.
 *
 * We use refs (`runningRef`, `stoppedRef`) for everything the loop reads so
 * the latest values are always seen.
 */
export function useCameraScanner(
  onResult: (r: ScanResult) => void,
  onError?: (msg: string) => void,
) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const [cameraState, setCameraState] = React.useState<CameraState>({ kind: "idle" });
  const [active, setActive] = React.useState(false);

  // Refs the scan loop reads. These always hold the latest value, regardless
  // of which render's `start` closure is currently running.
  const runningRef = React.useRef(false);
  const stoppedRef = React.useRef(false);
  // Keep `onResult` / `onError` fresh too — caller may pass new arrow fns
  // each render; we want the latest one inside the long-lived scan loop.
  const onResultRef = React.useRef(onResult);
  const onErrorRef = React.useRef(onError);
  React.useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  React.useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // throttle: only emit the same QR data once per ~240ms window
  const lastRef = React.useRef<{ data: string; ts: number } | null>(null);

  const stop = React.useCallback(() => {
    stoppedRef.current = true;
    runningRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // Stop any active stream tracks.
    setCameraState((cur) => {
      if (cur.kind === "running") {
        cur.track.stop();
        cur.stream.getTracks().forEach((t) => t.stop());
      }
      return { kind: "idle" };
    });
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setActive(false);
  }, []);

  const start = React.useCallback(async () => {
    if (runningRef.current || stoppedRef.current === false) {
      // already running, or this is the very first call before any stop
    }
    stoppedRef.current = false;
    setCameraState({ kind: "starting" });
    setActive(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API not available — open this page over HTTPS in a modern browser.");
      }
      // Note: facingMode 'environment' is a hint, not a hard constraint
      // (`ideal` instead of `exact`), so laptops with only a front webcam
      // still satisfy the request — they just use the front camera, which
      // is fine for scanning a screen.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const track = stream.getVideoTracks()[0];
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        setCameraState({ kind: "error", message: "Video element missing.", reason: "unknown" });
        setActive(false);
        return;
      }
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play();

      // Mark running BEFORE setting state so the scan loop (which may tick
      // on the very next animation frame) sees the right flag.
      runningRef.current = true;
      setCameraState({ kind: "running", track, stream });

      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas 2d context unavailable");

      const tick = () => {
        // Stop-signal check via ref (not closure-captured state).
        if (stoppedRef.current) {
          rafRef.current = null;
          return;
        }
        if (!runningRef.current) {
          // Not running yet (still starting) — keep polling until ready.
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (w && h) {
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            const imgData = ctx.getImageData(0, 0, w, h);
            // attemptBoth lets jsQR try both the natural and inverted color
            // order — costs ~1ms extra per frame but hugely improves decode
            // success on screens that confuse jsQR's luminance estimate
            // (white QR on a slightly-off-white screen, dark themes, etc).
            const code = jsQR(imgData.data, w, h, {
              inversionAttempts: "attemptBoth",
            });
            if (code && code.data) {
              const now = performance.now();
              const last = lastRef.current;
              if (!last || last.data !== code.data || now - last.ts > 240) {
                lastRef.current = { data: code.data, ts: now };
                onResultRef.current({
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
      runningRef.current = false;
      const { message, reason } = humanizeCameraError(e);
      setCameraState({ kind: "error", message, reason });
      setActive(false);
      onErrorRef.current?.(message);
    }
  }, []);

  // cleanup on unmount
  React.useEffect(() => {
    return () => {
      stoppedRef.current = true;
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setCameraState((cur) => {
        if (cur.kind === "running") {
          cur.stream.getTracks().forEach((t) => t.stop());
        }
        return { kind: "idle" };
      });
    };
  }, []);

  return {
    videoRef,
    canvasRef,
    start,
    stop,
    cameraState,
    active,
  };
}
