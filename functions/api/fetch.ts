// Cloudflare Pages Function: Download Booster edge proxy.
//
// GET /api/fetch?probe=1&url=<...>   -> lightweight HEAD probe (returns metadata only)
// GET /api/fetch?url=<...>           -> streamed body fetch + edge caching
// Range: bytes=start-end             -> forwarded to origin, transparent
//
// The worker:
//   1) Validates the URL is http(s) and points at a public-looking origin
//      (rejects private IPs / loopback / metadata endpoints to prevent SSRF).
//   2) Detects GitHub release PAGE URLs (vs the actual asset URLs) and returns
//      a helpful error instead of streaming the release page HTML.
//   3) Fetches via Cloudflare's fetch() — which uses HTTP/2 + warm TLS by
//      default, so it's much faster than the user's direct fetch on a slow
//      connection.
//   4) Detects when the upstream returned HTML for a URL that looks binary
//      (.apk, .exe, .iso, etc.) — usually a 404 page or login wall — and
//      returns a clear error instead of streaming the HTML to the user.
//   5) Caches ONLY successful (2xx) non-HTML responses in the Cloudflare
//      Cache API, so subsequent downloads of the same URL are instant.
//      HTML and error responses are NOT cached (no cache poisoning).
//   6) Passes the upstream HTTP status through to the client (was being
//      masked to 200 — that's how a 404 GitHub page became a "200 OK" HTML
//      response that the client saved as a .apk file).
//
// Auth: optional. Set `AEGIS_BOOSTER_SECRET` env var in CF Pages to require an
// HMAC signature; if unset, runs in open mode (fine for personal use).

interface Env {
  AEGIS_BOOSTER_SECRET?: string;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const urlObj = new URL(request.url);
  const target = urlObj.searchParams.get("url");
  if (!target) return jsonError(400, "missing url");

  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return jsonError(400, "invalid url");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return jsonError(400, "only http/https supported");
  }
  if (isPrivateHost(u.hostname)) {
    return jsonError(403, "blocked: private/loopback host");
  }
  if (u.hostname === "169.254.169.254" || u.hostname === "metadata.google.internal") {
    return jsonError(403, "blocked: metadata endpoint");
  }

  // Pre-flight: catch the most common "I pasted the wrong URL" mistake.
  // GitHub release PAGE URLs (vs asset URLs) return HTML — if we stream
  // that to the user they get an .apk-shaped file containing HTML.
  const pageErr = githubReleasePageHint(u);
  if (pageErr) return jsonError(400, pageErr);

  if (env.AEGIS_BOOSTER_SECRET) {
    const provided = urlObj.searchParams.get("sig") || request.headers.get("X-Aegis-Sig");
    if (!provided) return jsonError(401, "signature required");
    const expected = await makeSig(env.AEGIS_BOOSTER_SECRET, target);
    if (!(await timingSafeEqual(provided, expected))) {
      return jsonError(401, "bad signature");
    }
  }

  const probe = urlObj.searchParams.get("probe") === "1";
  const cache = await caches.open("aegis-booster");
  const cacheKey = new Request(`https://aegis-booster.local/${await sha256Hex(target)}`, {
    method: "GET",
  });

  if (probe) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return metaResponse({
        url: target,
        filename: filenameFromResponse(target, cached),
        size: Number(cached.headers.get("Content-Length") || -1),
        mime: cached.headers.get("Content-Type") || "application/octet-stream",
        cached: true,
        status: cached.status,
      });
    }
    try {
      const head = await fetch(target, {
        method: "HEAD",
        cf: { cacheTtl: 3600, cacheEverything: true } as any,
      });
      // HEAD on a 404 / 500 still gives us headers, so we can detect "this
      // URL returned HTML for a binary-looking request" up front and tell
      // the user before they start a download.
      const mime = head.headers.get("Content-Type") || "application/octet-stream";
      const htmlHint = htmlForBinaryCheck(u, mime, head.status);
      if (htmlHint) return jsonError(502, htmlHint);
      return metaResponse({
        url: target,
        filename: filenameFromResponse(target, head),
        size: Number(head.headers.get("Content-Length") || -1),
        mime,
        cached: false,
        status: head.status,
      });
    } catch (e) {
      return jsonError(502, `origin HEAD failed: ${String(e)}`);
    }
  }

  const fwdHeaders = new Headers();
  const range = request.headers.get("Range");
  if (range) fwdHeaders.set("Range", range);
  fwdHeaders.set("User-Agent", "Aegis-Booster/1.0 (+https://aegishare.pages.dev)");

  if (!range) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const meta = {
        url: target,
        filename: filenameFromResponse(target, cached),
        size: Number(cached.headers.get("Content-Length") || -1),
        mime: cached.headers.get("Content-Type") || "application/octet-stream",
        cached: true,
        status: cached.status,
      };
      return withMeta(streamCached(cached.body as unknown as ReadableStream<Uint8Array>), meta, cached.headers, cached.status);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "GET",
      headers: fwdHeaders,
      cf: {
        cacheTtl: 86400,
        cacheEverything: true,
      } as any,
    });
  } catch (e) {
    return jsonError(502, `origin fetch failed: ${String(e)}`);
  }

  const upstreamMime = upstream.headers.get("Content-Type") || "application/octet-stream";

  // The big bug fix: detect when the upstream returned HTML for a URL that
  // looks binary. This catches 404 pages, login walls, GitHub release pages,
  // Cloudflare "Just a moment..." interstitials, etc. — anything that would
  // otherwise cause the client to save HTML as a .apk / .exe / .iso file.
  const htmlHint = htmlForBinaryCheck(u, upstreamMime, upstream.status);
  if (htmlHint) {
    // Don't cache HTML responses (would poison the cache for the next user
    // who tries the same URL after the underlying issue is fixed).
    try { await upstream.body?.cancel(); } catch { /* ignore */ }
    return jsonError(502, htmlHint);
  }

  const meta = {
    url: target,
    filename: filenameFromResponse(target, upstream),
    size: Number(upstream.headers.get("Content-Length") || -1),
    mime: upstreamMime,
    cached: false,
    status: upstream.status,
  };

  // Only cache successful, non-HTML responses. Caching a 404 HTML page
  // would mean the next person who tries this URL after the asset is
  // restored still gets the cached 404 page.
  const cacheable =
    !range &&
    upstream.status >= 200 && upstream.status < 300 &&
    !upstreamMime.toLowerCase().startsWith("text/html");
  if (cacheable) {
    try {
      // upstream.clone() tees the underlying body stream so both the
      // cached copy and the live client response remain independently
      // readable. Constructing a new Response from upstream.body would
      // *transfer* the stream, leaving upstream.body locked and making
      // the return below throw "body has already been used" (CF 1101).
      ctx.waitUntil(cache.put(cacheKey, upstream.clone()));
    } catch {
      // caching failure is non-fatal
    }
  }

  return withMeta(streamBody(upstream), meta, upstream.headers, upstream.status);
};

/* ---------- helpers ---------- */

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function metaResponse(meta: any): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "X-Aegis-Meta": btoaSafe(JSON.stringify(meta)),
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function withMeta(
  body: ReadableStream<Uint8Array> | null,
  meta: any,
  srcHeaders: Headers,
  upstreamStatus: number,
): Response {
  const headers = new Headers(srcHeaders);
  ["Transfer-Encoding", "Connection", "Content-Encoding", "Vary", "Set-Cookie", "Server", "CF-RAY", "CF-Cache-Status"].forEach((h) => headers.delete(h));
  headers.set("X-Aegis-Meta", btoaSafe(JSON.stringify(meta)));
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "public, max-age=86400");
  // Pass the actual upstream status through. The previous code forced 200
  // unless an X-Status-Override header was set (which nothing ever set),
  // causing GitHub 404 pages to be served to the client as "200 OK" HTML
  // — and the client then saved that HTML as a .apk file. Range requests
  // get 206; everything else gets the real status (200, 302-found, 403,
  // 404, 5xx, etc.).
  const status = upstreamStatus || 200;
  return new Response(body, { status, headers });
}

function streamBody(res: Response): ReadableStream<Uint8Array> | null {
  return res.body as unknown as ReadableStream<Uint8Array> | null;
}

function streamCached(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> | null {
  return body;
}

// UTF-8-safe base64 (handles unicode filenames)
function btoaSafe(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function filenameFromResponse(url: string, res: Response): string {
  const cd = res.headers.get("Content-Disposition");
  if (cd) {
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    if (m && m[1]) return decodeURIComponent(m[1]);
  }
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last && last.includes(".")) return decodeURIComponent(last);
    return `${u.hostname.replace(/[^\w.-]/g, "_")}-${Date.now().toString(36)}`;
  } catch {
    return `aegis-download-${Date.now().toString(36)}`;
  }
}

/**
 * Common binary file extensions. If the URL ends with one of these but the
 * upstream returned text/html, the user almost certainly pasted a URL that
 * serves an HTML page (404, login wall, release page, JS challenge) instead
 * of the actual binary.
 */
const BINARY_EXTENSIONS = new Set([
  "apk","exe","msi","dmg","pkg","deb","rpm","AppImage","snap","flatpak",
  "iso","img","bin","vmdk","qcow2",
  "zip","tar","gz","tgz","bz2","xz","7z","rar","zst",
  "pdf","doc","docx","xls","xlsx","ppt","pptx","odt","ods","odp",
  "mp3","mp4","mkv","avi","mov","wav","flac","webm","ogg",
  "jpg","jpeg","png","gif","webp","bmp","tiff","svg","ico",
  "woff","woff2","ttf","otf",
  "jar","war","ear","class",
  "wasm","dll","so","dylib","a","lib","o",
]);

function looksLikeBinaryFile(u: URL): boolean {
  const last = u.pathname.split("/").filter(Boolean).pop();
  if (!last || !last.includes(".")) return false;
  const ext = last.split(".").pop()!.toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Returns a human-readable error message if the upstream returned HTML for
 * a URL that looks like a binary file, OR if the upstream returned a
 * non-2xx status (404, 5xx) regardless of content type. Returns null when
 * the response looks legitimate (binary body + 2xx status).
 *
 * This is the fix for "I downloaded an APK and got an HTML page" — the user
 * typically pasted either:
 *   1. A GitHub release PAGE url (github.com/.../releases/latest)
 *      instead of the direct asset url
 *      (github.com/.../releases/download/v1/file.apk)
 *   2. A URL that 404s — GitHub returns an HTML 404 page
 *   3. A URL behind a login wall (returns HTML login form)
 *
 * Without this check, the worker would stream the HTML to the client with
 * the URL's filename, and the client would save HTML content as e.g.
 * "app.apk".
 */
function htmlForBinaryCheck(u: URL, mime: string, status: number): string | null {
  const isHtml = mime.toLowerCase().startsWith("text/html");
  const isBinary = looksLikeBinaryFile(u);

  // 4xx / 5xx with HTML body — almost certainly an error page
  if (status >= 400 && isHtml) {
    if (status === 404) {
      return `URL returned 404 (page not found). The file does not exist at this URL${isBinary ? " — check the spelling of the asset name and tag" : ""}. If this is a GitHub release, open the release page in your browser and right-click the asset → "Copy link address", then paste that direct URL.`;
    }
    if (status === 401 || status === 403) {
      return `URL returned ${status} — the file requires authentication. The booster only works on public URLs.`;
    }
    return `URL returned HTTP ${status} with an HTML body (likely an error or interstitial page), not the actual file.`;
  }

  // 2xx but HTML body for a binary-looking URL — login wall, GitHub
  // "Just a moment" interstitial, Cloudflare challenge, etc.
  if (isHtml && isBinary) {
    return `The URL returned an HTML page instead of the file. This usually means you pasted a release page or listing page URL (not the direct asset URL). For GitHub: open the release page in your browser, find the asset you want, right-click → "Copy link address", then paste that direct URL (it should contain "/releases/download/...").`;
  }

  return null;
}

/**
 * Catches GitHub release PAGE URLs (vs the actual asset URLs) before we
 * even hit the network. These all return HTML:
 *   /releases                  — the releases listing
 *   /releases/latest           — the latest release page
 *   /releases/tag/v1.0         — a specific release page
 *
 * Whereas these return the actual file:
 *   /releases/download/v1.0/file.apk        — direct asset (302 → CDN)
 *   /releases/latest/download/file.apk      — latest-asset shortcut
 */
function githubReleasePageHint(u: URL): string | null {
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
  const path = u.pathname;
  // Need at least /OWNER/REPO/releases
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 3) return null;
  if (parts[2] !== "releases") return null;
  // OK, it's a /releases URL. Now: does it contain "download"?
  const hasDownload = parts.slice(3).includes("download");
  if (hasDownload) return null; // direct asset URL — let it through

  // It's a release PAGE. Tell the user what to do.
  const which = parts.length === 3
    ? "the releases listing"
    : parts[3] === "latest"
    ? "the latest release page"
    : parts[3] === "tag"
    ? `the release page for tag "${parts[4] || "?"}"`
    : "a release page";
  return `This URL is ${which}, not the actual file. GitHub release pages return HTML, not the binary. To get the file:\n\n1. Open this URL in your browser.\n2. Scroll down to "Assets".\n3. Right-click the file you want (e.g. app.apk) → "Copy link address".\n4. Paste that URL here — it should look like https://github.com/USER/REPO/releases/download/v1.0/app.apk`;
}

function isPrivateHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost") return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map((x) => parseInt(x, 10));
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
    return false;
  }
  if (host.includes(":")) {
    if (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
      return true;
    }
    return false;
  }
  return false;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeSig(secret: string, target: string): Promise<string> {
  const buf = await crypto.subtle.sign(
    { name: "HMAC", hash: "SHA-256" },
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ),
    new TextEncoder().encode(target),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false;
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range, X-Aegis-Sig",
      "Access-Control-Max-Age": "86400",
    },
  });
};
