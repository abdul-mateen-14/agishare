"use client";

import * as React from "react";

/**
 * Registers the Aegis Share service worker in production so the app
 * works offline. Skipped in dev (`next dev`) to avoid caching HMR assets.
 *
 * The SW lives at /sw.js (served as a static file from out/) and only
 * caches same-origin GETs plus precaches the app shell. Cross-origin
 * requests and /api/* (the booster Function) always hit the network.
 */
export function SwRegister() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Skip in dev to avoid caching hot-reloaded chunks.
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // Swallow registration failures silently — offline support is
          // a progressive enhancement, not a hard dependency.
          console.warn("[aegis-sw] registration failed:", err);
        });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
