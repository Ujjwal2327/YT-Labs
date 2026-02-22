// 📁 app/api/stream-url/route.js
// Returns direct YouTube CDN stream URLs for device-mode downloads.
//
// On Vercel: uses @distube/ytdl-core (pure JS, no binary).
// On Railway/local: uses yt-dlp binary (better quality, 4K support).
//
// DEVICE MODE CONSTRAINTS:
//  ffmpeg.wasm runs in the browser and buffers entire streams in RAM.
//  Hard-capped at 1080p. Prefers h264 (avc1) for smaller size + browser compat.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// yt-dlp format selectors (Railway/local only)
const DEVICE_VIDEO_FORMAT_MAP = {
  highest: "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]",
  "1080p": "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]",
  "720p":  "bestvideo[height<=720][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]",
  "480p":  "bestvideo[height<=480][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]",
  "360p":  "bestvideo[height<=360][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[height<=360]",
  lowest:  "worstvideo+worstaudio/worst",
};

export async function GET(req) {
  const { searchParams } = req.nextUrl;
  const videoId = searchParams.get("videoId");
  const format  = searchParams.get("format")  || "mp4";
  const quality = searchParams.get("quality") || "highest";

  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }

  // ── Vercel: use pure-JS ytdl-core (no binary needed) ──────────────────────
  if (process.env.VERCEL) {
    try {
      const { getStreamUrls } = await import("@/lib/ytdlp-vercel");
      const result = await getStreamUrls(videoId, format, quality);
      return NextResponse.json(result);
    } catch (err) {
      console.error("stream-url error (ytdl-core):", err);
      return NextResponse.json(
        { error: err?.message || "Failed to extract stream URL" },
        { status: 500 }
      );
    }
  }

  // ── Railway / local: use yt-dlp binary ────────────────────────────────────
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const baseOpts = { quiet: true, noWarnings: true };

  try {
    const { getYtDlp, withRetry } = await import("@/lib/ytdlp");
    const youtubeDl = await getYtDlp();

    const selectedFormat = format === "mp3"
      ? "bestaudio[ext=m4a]/bestaudio/best"
      : DEVICE_VIDEO_FORMAT_MAP[quality] || DEVICE_VIDEO_FORMAT_MAP.highest;

    const [infoRaw, urlsRaw] = await Promise.all([
      withRetry(() =>
        youtubeDl(videoUrl, { dumpSingleJson: true, format: selectedFormat, ...baseOpts })
      ),
      withRetry(() =>
        youtubeDl(videoUrl, { getUrl: true, format: selectedFormat, ...baseOpts })
      ),
    ]);

    const safeName = (infoRaw.title || `media_${videoId}`)
      .replace(/[^\w\s\-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 100);

    const urls = String(urlsRaw)
      .trim()
      .split("\n")
      .map(u => u.trim())
      .filter(Boolean);

    if (urls.length === 0) {
      return NextResponse.json({ error: "No stream URLs found" }, { status: 500 });
    }

    let videoExt = "mp4";
    let audioExt = "m4a";

    if (infoRaw.requested_formats?.length >= 2) {
      videoExt = infoRaw.requested_formats[0]?.ext || "mp4";
      audioExt = infoRaw.requested_formats[1]?.ext || "m4a";
    } else if (infoRaw.requested_formats?.length === 1) {
      videoExt = infoRaw.requested_formats[0]?.ext || "mp4";
      audioExt = infoRaw.requested_formats[0]?.ext || "mp4";
    } else if (infoRaw.ext) {
      videoExt = infoRaw.ext;
      audioExt = infoRaw.ext;
    }

    const resolvedAudioExt = format === "mp3" ? (infoRaw.ext || audioExt) : audioExt;

    if (infoRaw.requested_formats) {
      const vf = infoRaw.requested_formats[0];
      const af = infoRaw.requested_formats[1];
      console.log(`[stream-url] video: ${vf?.height}p ${vf?.vcodec} ext=${vf?.ext}`);
      console.log(`[stream-url] audio: ${af?.abr}kbps ${af?.acodec} ext=${af?.ext}`);
    }

    return NextResponse.json({
      videoId,
      title:           infoRaw.title || "Unknown",
      filename:        safeName,
      format,
      quality,
      streamType:      urls.length === 1 ? "single" : "dual",
      url:             urls[0] || null,
      videoUrl:        urls.length > 1 ? urls[0] : null,
      audioUrl:        urls.length > 1 ? urls[1] : null,
      videoExt,
      audioExt:        resolvedAudioExt,
      durationSeconds: infoRaw.duration || 0,
    });

  } catch (err) {
    console.error("stream-url error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to extract stream URL" },
      { status: 500 }
    );
  }
}