// Cloudflare Pages Function: Download Booster edge proxy.
//
// GET /api/fetch?probe=1&url=<...>   -> lightweight HEAD probe (returns metadata only)
// GET /api/fetch?url=<...>           -> streamed body fetch + edge caching
// Range: bytes=start-end             -> forwarded to origin, transparent
//
// The worker:
//   1) Validates the URL is http(s) and points at a public-looking origin
//      (rejects private IPs / loopback / metadata endpoints to prevent SSRF).
//   2) Fetches via Cloudflare's fetch() — which uses HTTP/2 + warm TLS by
//      default, so it's much faster than the user's direct fetch on a slow
//      connection.
//   3) Caches the response in the Cloudflare Cache API keyed by URL hash so
//      subsequent downloads are instant.
//   4) Streams the body back to the client. Range requests are forwarded.
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
      });
    }
    try {
      const head = await fetch(target, {
        method: "HEAD",
        cf: { cacheTtl: 3600, cacheEverything: true } as any,
      });
      return metaResponse({
        url: target,
        filename: filenameFromResponse(target, head),
        size: Number(head.headers.get("Content-Length") || -1),
        mime: head.headers.get("Content-Type") || "application/octet-stream",
        cached: false,
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
      };
      return withMeta(streamCached(cached.body as unknown as ReadableStream<Uint8Array>), meta, cached.headers);
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

  const meta = {
    url: target,
    filename: filenameFromResponse(target, upstream),
    size: Number(upstream.headers.get("Content-Length") || -1),
    mime: upstream.headers.get("Content-Type") || "application/octet-stream",
    cached: false,
  };

  if (!range && upstream.status >= 200 && upstream.status < 300) {
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

  return withMeta(streamBody(upstream), meta, upstream.headers);
};

/* ---------- helpers ---------- */

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
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

function withMeta(body: ReadableStream<Uint8Array> | null, meta: any, srcHeaders: Headers): Response {
  const headers = new Headers(srcHeaders);
  ["Transfer-Encoding", "Connection", "Content-Encoding", "Vary", "Set-Cookie", "Server", "CF-RAY", "CF-Cache-Status"].forEach((h) => headers.delete(h));
  headers.set("X-Aegis-Meta", btoaSafe(JSON.stringify(meta)));
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "public, max-age=86400");
  const status = Number(srcHeaders.get("X-Status-Override")) || 200;
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
