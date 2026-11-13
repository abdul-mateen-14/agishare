/**
 * Download Booster — paste a slow/remote URL, get it fast.
 *
 * The problem: when you download a file from a public CDN / GitHub release /
 * random website, the source often throttles you, has high RTT, or sits
 * behind a slow origin. Your browser opens a single TCP+TLS connection and
 * pulls the file linearly — slow.
 *
 * The fix: Aegis's Cloudflare Pages edge worker (functions/fetch-proxy.ts)
 * does the heavy fetch from a Cloudflare datacenter close to the origin
 * (HTTP/2 multiplexed, TLS warm), caches the response at the edge (Cloudflare
 * Cache API), and streams it to you over your fast connection to Cloudflare.
 * Subsequent downloads of the same URL are instant because the edge already
 * has the bytes.
 *
 * Privacy / trust model:
 *  - Plain URLs go to the edge worker which logs nothing, stores only the
 *    cached body, and forwards Range requests. The worker doesn't read,
 *    modify, or inspect the body.
 *  - For sensitive URLs you should still use the P2P or Link modes — those
 *    keep bytes out of any intermediary. The booster is a convenience tool
 *    for public files (open-source releases, public datasets, etc.).
 *
 * AuthN: each session mints a short-lived HMAC signature (BoosterKey) in the
 * browser; the worker validates it before serving. This stops random
 * internet users from using your deployment as an open proxy while still
 * keeping it serverless. The BoosterKey is derived from a deployment-wide
 * secret you set in CF Pages env (AEGIS_BOOSTER_SECRET). If unset, the
 * worker runs in open mode (suitable for personal use).
 */

const PROXY_PATH = "/api/fetch";

/* ---------- types ---------- */

export type BoosterMeta = {
  url: string;
  /** Best-effort filename extracted from the URL or Content-Disposition */
  filename: string;
  /** Size in bytes, if known from a HEAD probe (-1 if unknown) */
  size: number;
  /** Mime type, if known */
  mime: string;
  /** Whether the resource is already cached at the edge */
  cached: boolean;
  /** Upstream HTTP status (the worker now passes this through instead of
   *  masking it to 200). 200 = OK, 206 = partial (range), 404 = not found,
   *  403/401 = auth required, 5xx = origin error. */
  status?: number;
};

export type BoosterProgress = {
  bytesReceived: number;
  totalBytes: number; // -1 if unknown
  percent: number; // -1 if unknown
  speedBps: number;
  done: boolean;
};

/* ---------- url utilities ---------- */

export function isProbablyPublicUrl(s: string): {
  ok: boolean;
  reason?: string;
} {
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return { ok: false, reason: "Only http/https URLs are supported" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
}

export function guessFilename(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last && last.includes(".")) return decodeURIComponent(last);
    // fallback: hostname + no extension
    return `${u.hostname.replace(/[^\w.-]/g, "_")}-${Date.now().toString(36)}`;
  } catch {
    return `aegis-download-${Date.now().toString(36)}`;
  }
}

/* ---------- head probe (cheap, preflight) ---------- */

export async function probeUrl(url: string): Promise<BoosterMeta> {
  const res = await fetch(`${PROXY_PATH}?probe=1&url=${encodeURIComponent(url)}`, {
    method: "GET",
    headers: { "X-Aegis-Booster": "probe" },
  });
  if (!res.ok) {
    // Worker returns JSON errors with { error: "..." } for known failure
    // cases (HTML page detected, GitHub release page URL, 404, etc.).
    // Surface those errors to the user instead of letting them click
    // Download and get an HTML file saved as .apk.
    const txt = await res.text().catch(() => "");
    let msg = `Probe failed (${res.status})`;
    try {
      const j = JSON.parse(txt);
      if (j.error) msg = j.error;
    } catch { /* not JSON, fall through */ }
    throw new Error(msg);
  }
  const metaJson = res.headers.get("X-Aegis-Meta");
  if (!metaJson) throw new Error("Worker did not return metadata");
  const meta = JSON.parse(atob(metaJson)) as BoosterMeta;
  // Defense in depth: even if the worker didn't catch an HTML response,
  // refuse to let the user download what's clearly an HTML page.
  if (meta.mime && meta.mime.toLowerCase().startsWith("text/html")) {
    throw new Error(
      `This URL returns an HTML page, not a file (mime: ${meta.mime}). You likely pasted a release page URL instead of the direct asset URL. For GitHub: open the release page in your browser, right-click the asset → "Copy link address", then paste that URL (it should contain "/releases/download/...").`,
    );
  }
  return meta;
}

/* ---------- main download with progress ---------- */

/**
 * Download `url` via the edge proxy with a streaming progress callback.
 * Returns the final Blob. Uses fetch + ReadableStream reader; works on every
 * modern browser including mobile Safari.
 */
export async function downloadBoosted(
  url: string,
  onProgress: (p: BoosterProgress) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; meta: BoosterMeta }> {
  const proxyUrl = `${PROXY_PATH}?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl, { signal });
  // The worker now passes the upstream status through. So a 404 from
  // GitHub comes back as 404 (not masked to 200). 206 is fine (range
  // request). Anything else 4xx/5xx: surface the worker's JSON error.
  if (!res.ok && res.status !== 206) {
    const txt = await res.text().catch(() => "");
    let msg = `Fetch failed (${res.status})`;
    try {
      const j = JSON.parse(txt);
      if (j.error) msg = j.error;
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const metaJson = res.headers.get("X-Aegis-Meta");
  const meta: BoosterMeta = metaJson
    ? (JSON.parse(atob(metaJson)) as BoosterMeta)
    : { url, filename: guessFilename(url), size: -1, mime: "application/octet-stream", cached: false };

  // Defense in depth: if the worker somehow let an HTML response through,
  // refuse to save it as a binary file. The user would otherwise download
  // a .apk file containing HTML.
  const respMime = (res.headers.get("Content-Type") || meta.mime || "").toLowerCase();
  if (respMime.startsWith("text/html")) {
    throw new Error(
      "The server returned an HTML page instead of the file. The URL likely points at a release page or login wall, not the direct file. For GitHub: open the release page in your browser, right-click the asset → \"Copy link address\", then paste that URL.",
    );
  }

  const total = Number(res.headers.get("Content-Length") || meta.size || -1);
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Response not streamable");
  const chunks: Uint8Array[] = [];
  let received = 0;
  const startedAt = performance.now();

  // read loop
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const elapsed = (performance.now() - startedAt) / 1000;
    onProgress({
      bytesReceived: received,
      totalBytes: total,
      percent: total > 0 ? (received / total) * 100 : -1,
      speedBps: elapsed > 0 ? received / elapsed : 0,
      done: false,
    });
  }
  onProgress({
    bytesReceived: received,
    totalBytes: total > 0 ? total : received,
    percent: total > 0 ? 100 : -1,
    speedBps: 0,
    done: true,
  });
  // Concatenate Uint8Array chunks into a single Blob (BlobPart cast)
  const blob = new Blob(chunks as BlobPart[], {
    type: meta.mime || "application/octet-stream",
  });
  return { blob, meta };
}

/* ---------- helpers ---------- */

export function formatBytes(n: number): string {
  if (n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}

/** Remaining-time estimate, returns null if we can't compute. */
export function estimateEta(received: number, total: number, speedBps: number): number | null {
  if (total <= 0 || speedBps <= 0 || received >= total) return null;
  return (total - received) / speedBps;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
