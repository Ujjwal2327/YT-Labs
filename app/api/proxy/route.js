// 📁 app/api/proxy/route.js
// Chunked CORS bypass proxy — streams YouTube CDN bytes to the browser.
// Fetches in 4 MB chunks using Range requests to avoid ECONNRESET on large files.
// YouTube CDN drops connections on long single-range requests; chunking works around this.
// Security: only proxies *.googlevideo.com and *.youtube.com URLs.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED_HOSTS = [".googlevideo.com", ".youtube.com", ".ytimg.com"];

// YouTube CDN tolerates ~4 MB chunks reliably. Larger = more resets.
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB

// Max retries per chunk on transient errors (ECONNRESET, 5xx, etc.)
const MAX_CHUNK_RETRIES = 3;

function isAllowedUrl(rawUrl) {
  try {
    const { hostname } = new URL(rawUrl);
    return ALLOWED_HOSTS.some((suffix) => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetches a single byte range from the CDN with retry on transient errors.
 * Returns a Uint8Array of the chunk bytes.
 */
async function fetchChunk(targetUrl, start, end, attempt = 1) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Encoding": "identity",
    Range: `bytes=${start}-${end}`,
  };

  let res;
  try {
    res = await fetch(targetUrl, { headers });
  } catch (err) {
    if (attempt < MAX_CHUNK_RETRIES) {
      await sleep(500 * attempt);
      return fetchChunk(targetUrl, start, end, attempt + 1);
    }
    throw err;
  }

  // 416 = range not satisfiable (past EOF) — signal caller to stop
  if (res.status === 416) return null;

  if (!res.ok && res.status !== 206) {
    if (attempt < MAX_CHUNK_RETRIES && res.status >= 500) {
      await sleep(500 * attempt);
      return fetchChunk(targetUrl, start, end, attempt + 1);
    }
    throw new Error(`CDN error ${res.status} on bytes ${start}-${end}`);
  }

  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Probes the CDN for content-length and content-type via a HEAD-style range request.
 * Returns { totalSize, contentType } or null on failure.
 */
async function probeStream(targetUrl) {
  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Encoding": "identity",
        Range: "bytes=0-0",
      },
    });

    const contentType = res.headers.get("content-type") || "application/octet-stream";

    // content-range: bytes 0-0/TOTAL
    const cr = res.headers.get("content-range");
    if (cr) {
      const match = cr.match(/bytes\s+\d+-\d+\/(\d+)/);
      if (match) return { totalSize: parseInt(match[1]), contentType };
    }

    // Fallback: content-length from a non-ranged response
    const cl = res.headers.get("content-length");
    if (cl) return { totalSize: parseInt(cl), contentType };

    return { totalSize: null, contentType };
  } catch {
    return { totalSize: null, contentType: "application/octet-stream" };
  }
}

export async function GET(req) {
  const { searchParams } = req.nextUrl;
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  }

  if (!isAllowedUrl(targetUrl)) {
    return NextResponse.json(
      { error: "URL not allowed — only YouTube CDN URLs are proxied" },
      { status: 403 }
    );
  }

  // ── Simple pass-through for thumbnail images (small, no chunking needed) ──
  const isThumbnail =
    targetUrl.includes("ytimg.com") || targetUrl.includes("/vi/");

  if (isThumbnail) {
    try {
      const upstream = await fetch(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (!upstream.ok) {
        return NextResponse.json(
          { error: `Upstream error ${upstream.status}` },
          { status: upstream.status }
        );
      }
      const headers = new Headers();
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Cache-Control", "no-store");
      const ct = upstream.headers.get("content-type");
      if (ct) headers.set("Content-Type", ct);
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (err) {
      console.error("Thumbnail proxy error:", err);
      return NextResponse.json({ error: err?.message || "Proxy failed" }, { status: 500 });
    }
  }

  // ── Chunked streaming proxy for video/audio ────────────────────────────────
  try {
    const { totalSize, contentType } = await probeStream(targetUrl);

    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("Content-Type", contentType);
    if (totalSize) {
      responseHeaders.set("Content-Length", String(totalSize));
    }

    // Check if browser requested a specific range (e.g. video seek)
    const browserRange = req.headers.get("range");
    let rangeStart = 0;
    let rangeEnd = totalSize ? totalSize - 1 : Infinity;
    let isRangeRequest = false;

    if (browserRange && totalSize) {
      const match = browserRange.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        rangeStart = parseInt(match[1]);
        rangeEnd = match[2] ? parseInt(match[2]) : totalSize - 1;
        isRangeRequest = true;
        responseHeaders.set(
          "Content-Range",
          `bytes ${rangeStart}-${rangeEnd}/${totalSize}`
        );
        responseHeaders.set("Content-Length", String(rangeEnd - rangeStart + 1));
      }
    }

    if (totalSize) {
      responseHeaders.set("Accept-Ranges", "bytes");
    }

    // Build a ReadableStream that fetches CHUNK_SIZE chunks sequentially
    const stream = new ReadableStream({
      async start(controller) {
        let pos = rangeStart;
        const end = rangeEnd === Infinity ? null : rangeEnd;

        while (true) {
          // Determine chunk end byte
          const chunkEnd = end !== null
            ? Math.min(pos + CHUNK_SIZE - 1, end)
            : pos + CHUNK_SIZE - 1;

          let chunk;
          try {
            chunk = await fetchChunk(targetUrl, pos, chunkEnd);
          } catch (err) {
            console.error(`[proxy] chunk fetch failed at ${pos}-${chunkEnd}:`, err.message);
            controller.error(err);
            return;
          }

          // null = 416 (past EOF)
          if (!chunk || chunk.length === 0) break;

          controller.enqueue(chunk);
          pos += chunk.length;

          // Stop if we've reached the requested end or got less than a full chunk (EOF)
          if ((end !== null && pos > end) || chunk.length < CHUNK_SIZE) break;
        }

        controller.close();
      },
    });

    return new Response(stream, {
      status: isRangeRequest ? 206 : 200,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("Proxy error:", err);
    return NextResponse.json(
      { error: err?.message || "Proxy failed" },
      { status: 500 }
    );
  }
}