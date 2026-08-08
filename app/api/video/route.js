// 📁 app/api/video/route.js
import { NextResponse } from "next/server";
import {
  getYtDlp,
  withRetry,
  baseOpts,
  friendlyError,
  resolveCookies,
  cleanupCookies,
} from "@/lib/ytdlp";

export const runtime = "nodejs";
export const maxDuration = 60;

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be")
      return parsed.pathname.slice(1).split("?")[0];
    if (parsed.pathname.startsWith("/shorts/"))
      return parsed.pathname.split("/")[2] || null;
    return parsed.searchParams.get("v") || null;
  } catch {
    return null;
  }
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatViews(n) {
  if (!n) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export async function GET(req) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  const videoId = extractVideoId(url);
  if (!videoId)
    return NextResponse.json(
      { error: "Invalid video URL — must contain a video ID" },
      { status: 400 },
    );

  const cookies = await resolveCookies(req);
  try {
    const youtubeDl = await getYtDlp();

    const info = await withRetry(() =>
      youtubeDl(
        `https://www.youtube.com/watch?v=${videoId}`,
        baseOpts({ dumpSingleJson: true }, cookies.filePath),
      ),
    );

    const raw = info.upload_date || "";
    const uploadDateDisplay =
      raw.length === 8
        ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
        : "";

    const thumbs = info.thumbnails || [];
    const bestThumb =
      thumbs.find((t) => t.id === "maxresdefault")?.url ||
      thumbs.find((t) => (t.width || 0) >= 1280)?.url ||
      info.thumbnail ||
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

    return NextResponse.json({
      videoId,
      title: info.title || "Unknown",
      author: info.uploader || info.channel || "Unknown",
      channelId: info.channel_id || null,
      width: info.width || null,
      height: info.height || null,
      duration: formatDuration(info.duration || 0),
      durationSeconds: info.duration || 0,
      thumbnail: bestThumb,
      viewCount: info.view_count || 0,
      viewCountDisplay: formatViews(info.view_count),
      likeCount: info.like_count || 0,
      uploadDate: raw,
      uploadDateDisplay,
      description: (info.description || "").slice(0, 300),
      categories: info.categories || [],
      tags: (info.tags || []).slice(0, 8),
    });
  } catch (err) {
    console.error("Video fetch error:", err?.stderr || err);
    return NextResponse.json({ error: friendlyError(err) }, { status: 500 });
  } finally {
    await cleanupCookies(cookies);
  }
}
