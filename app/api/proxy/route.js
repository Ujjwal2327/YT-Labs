// 📁 app/api/proxy/route.js
// Ultra-thin CORS bypass proxy — streams YouTube CDN bytes to the browser.
// Zero disk I/O, zero processing. Just byte forwarding.
// Security: only proxies *.googlevideo.com and *.youtube.com URLs.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED_HOSTS = [".googlevideo.com", ".youtube.com", ".ytimg.com"];

function isAllowedUrl(rawUrl) {
  try {
    const { hostname } = new URL(rawUrl);
    return ALLOWED_HOSTS.some(suffix => hostname.endsWith(suffix));
  } catch {
    return false;
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

  try {
    const upstreamHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Encoding": "identity",
    };

    // Only forward Range if the browser actually sent one — empty Range header causes 416
    const rangeHeader = req.headers.get("range");
    if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

    let upstream = await fetch(targetUrl, { headers: upstreamHeaders });

    // 416 = CDN rejected the range — retry without it
    if (upstream.status === 416) {
      delete upstreamHeaders["Range"];
      upstream = await fetch(targetUrl, { headers: upstreamHeaders });
    }

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: `Upstream error ${upstream.status}` },
        { status: upstream.status }
      );
    }

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "no-store");

    const ct = upstream.headers.get("content-type");
    const cl = upstream.headers.get("content-length");
    const cr = upstream.headers.get("content-range");
    if (ct) headers.set("Content-Type", ct);
    if (cl) headers.set("Content-Length", cl);
    if (cr) headers.set("Content-Range", cr);

    return new Response(upstream.body, { status: upstream.status, headers });

  } catch (err) {
    console.error("Proxy error:", err);
    return NextResponse.json({ error: err?.message || "Proxy failed" }, { status: 500 });
  }
}