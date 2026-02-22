// 📁 app/api/stream-url/route.js
// Returns direct YouTube CDN stream URLs extracted by yt-dlp for device-mode downloads.
//
// DEVICE MODE CONSTRAINTS:
//  ffmpeg.wasm runs in the browser and buffers entire streams in RAM before muxing.
//  A 4K/AV1 video can be 2-4GB — impossible to allocate in a browser ArrayBuffer.
//  So device mode is hard-capped at 1080p and prefers h264 (avc1) over VP9/AV1:
//    - h264 files are ~2-4x smaller than AV1 at equivalent quality
//    - ffmpeg.wasm's single-threaded WASM core handles h264 much faster
//    - Stays well under browser memory limits (~500MB practical ceiling)
//
// Server mode has no such limit — use that for 4K/highest quality.

import { getYtDlp, withRetry } from "@/lib/ytdlp";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Device mode format selectors.
// Capped at 1080p. Prefers h264 (avc1) for smaller size + browser compat.
// Falls back to any codec if h264 not available at that resolution.
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

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const baseOpts = {
    quiet:      true,
    noWarnings: true,
  };

  const isVercel = !!process.env.VERCEL;

  try {
    const youtubeDl = await getYtDlp();

    const selectedFormat = format === "mp3"
      ? "bestaudio[ext=m4a]/bestaudio/best"
      : DEVICE_VIDEO_FORMAT_MAP[quality] || DEVICE_VIDEO_FORMAT_MAP.highest;

    const retries = isVercel ? 1 : 3;

    const [infoRaw, urlsRaw] = await Promise.all([
      withRetry(() =>
        youtubeDl(videoUrl, { dumpSingleJson: true, format: selectedFormat, ...baseOpts }),
        retries, 1000
      ),
      withRetry(() =>
        youtubeDl(videoUrl, { getUrl: true, format: selectedFormat, ...baseOpts }),
        retries, 1000
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

    // Determine actual container extensions for ffmpeg.wasm demuxing
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

    // Log selected streams for debugging
    if (infoRaw.requested_formats) {
      const vf = infoRaw.requested_formats[0];
      const af = infoRaw.requested_formats[1];
      console.log(`[stream-url device] video: ${vf?.height}p ${vf?.vcodec} ext=${vf?.ext}`);
      console.log(`[stream-url device] audio: ${af?.abr}kbps ${af?.acodec} ext=${af?.ext}`);
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