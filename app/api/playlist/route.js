// 📁 app/api/playlist/route.js
import { create } from "youtube-dl-exec";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const binName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const binPath = path.join(process.cwd(), "node_modules", "youtube-dl-exec", "bin", binName);
const youtubeDl = create(binPath);

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
  // Flat entries that are just URL stubs have no duration/title
  if (entry.availability === "private" || entry.availability === "needs_auth") return false;
  return true;
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
    // --flat-playlist         → fast, one HTTP request for the whole playlist
    // --ignore-errors         → skip private/deleted videos instead of crashing
    // --extractor-args        → tell youtube tab extractor to include more metadata
    //
    // Flat entries DO carry: id, title, duration, view_count, upload_date, channel, thumbnail
    // They just won't have format lists — which we don't need for the playlist index.
    const data = await youtubeDl(
      `https://www.youtube.com/playlist?list=${playlistId}`,
      {
        dumpSingleJson: true,
        flatPlaylist: true,
        ignoreErrors: true,   // ← key fix: skip unavailable instead of crashing
        quiet: true,
        noWarnings: true,
      }
    );

    const allEntries = data.entries || [];
    const entries = allEntries.filter(isAvailable);
    const unavailableCount = allEntries.length - entries.length;

    let idx = 1;
    const videos = entries.map((entry) => {
      const secs = entry.duration || 0;

      // upload_date is "YYYYMMDD" — flat playlist includes it for available videos
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
        uploadDate: raw,           // "YYYYMMDD" for sorting
        uploadDateDisplay,         // "YYYY-MM-DD" for display
      };
    });

    const totalSeconds = videos.reduce((sum, v) => sum + v.durationSeconds, 0);
    const avgSeconds = videos.length > 0 ? Math.round(totalSeconds / videos.length) : 0;

    return NextResponse.json({
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
    });
  } catch (err) {
    console.error("Playlist fetch error:", err);

    // If yt-dlp exited with an error but still produced stdout (partial data), use it
    if (err.stdout) {
      try {
        const data = JSON.parse(err.stdout);
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
            author: entry.uploader || entry.channel || data.uploader || "Unknown",
            index: idx++,
            viewCount: entry.view_count || 0,
            uploadDate: raw,
            uploadDateDisplay,
          };
        });
        const totalSeconds = videos.reduce((sum, v) => sum + v.durationSeconds, 0);
        const avgSeconds = videos.length > 0 ? Math.round(totalSeconds / videos.length) : 0;
        return NextResponse.json({
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
        });
      } catch (_) {
        // fall through to error response
      }
    }

    return NextResponse.json(
      { error: err?.message || "Failed to fetch playlist" },
      { status: 500 }
    );
  }
}