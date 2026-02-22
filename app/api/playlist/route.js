// 📁 app/api/playlist/route.js
import { getYtDlp, getCookiePath } from "@/lib/ytdlp";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function extractPlaylistId(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("list") || null;
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

const UNAVAILABLE_TITLES = new Set([
  "[private video]",
  "[deleted video]",
  "[unavailable]",
]);

function isAvailable(entry) {
  if (!entry || !entry.id) return false;
  const title = (entry.title || "").toLowerCase().trim();
  if (UNAVAILABLE_TITLES.has(title)) return false;
  if (entry.availability === "private" || entry.availability === "needs_auth") return false;
  return true;
}

function buildResponse(data, playlistId) {
  const allEntries = data.entries || [];
  const entries = allEntries.filter(isAvailable);
  const unavailableCount = allEntries.length - entries.length;

  let idx = 1;
  const videos = entries.map((entry) => {
    const secs = entry.duration || 0;
    const raw = entry.upload_date || "";
    const uploadDateDisplay = raw.length === 8
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
      : "";
    return {
      videoId: entry.id,
      title: entry.title || "Unknown",
      duration: formatDuration(secs),
      durationSeconds: secs,
      thumbnail: `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`,
      author: entry.uploader || entry.channel || entry.uploader_id || data.uploader || "Unknown",
      index: idx++,
      viewCount: entry.view_count || 0,
      uploadDate: raw,
      uploadDateDisplay,
    };
  });

  const totalSeconds = videos.reduce((sum, v) => sum + v.durationSeconds, 0);
  const avgSeconds = videos.length > 0 ? Math.round(totalSeconds / videos.length) : 0;

  return {
    playlistId,
    title: data.title || "Unknown Playlist",
    author: data.uploader || data.channel || "Unknown",
    videoCount: videos.length,
    unavailableCount,
    videos,
    totalDuration: formatDuration(totalSeconds),
    totalSeconds,
    averageDuration: formatDuration(avgSeconds),
    averageSeconds: avgSeconds,
  };
}

export async function GET(req) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  const playlistId = extractPlaylistId(url);
  if (!playlistId) {
    return NextResponse.json(
      { error: "Invalid playlist URL — must contain ?list=..." },
      { status: 400 }
    );
  }

  try {
    const youtubeDl = await getYtDlp();
    const cookiePath = getCookiePath();

    const data = await youtubeDl(
      `https://www.youtube.com/playlist?list=${playlistId}`,
      {
        dumpSingleJson: true,
        flatPlaylist: true,
        ignoreErrors: true,
        quiet: true,
        noWarnings: true,
        // Pass cookies if available (needed on cloud servers to bypass bot detection)
        ...(cookiePath && { cookies: cookiePath }),
      }
    );

    return NextResponse.json(buildResponse(data, playlistId));
  } catch (err) {
    console.error("Playlist fetch error:", err);

    // yt-dlp exited non-zero but still wrote JSON to stdout — use the partial data
    if (err.stdout) {
      try {
        const data = JSON.parse(err.stdout);
        return NextResponse.json(buildResponse(data, playlistId));
      } catch (_) {}
    }

    return NextResponse.json(
      { error: err?.message || "Failed to fetch playlist" },
      { status: 500 }
    );
  }
}