import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

function extractPlaylistId(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.searchParams.get("list") ||
      parsed.pathname.split("/").pop() ||
      null
    );
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

async function fetchPlaylistVideos(playlistId) {
  const response = await fetch(
    `https://www.youtube.com/playlist?list=${playlistId}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }
  );

  const html = await response.text();

  const match = html.match(/var ytInitialData = ({.+?});<\/script>/s);
  if (!match) throw new Error("Could not parse playlist data");

  const data = JSON.parse(match[1]);

  const title =
    data?.metadata?.playlistMetadataRenderer?.title ||
    data?.header?.playlistHeaderRenderer?.title?.runs?.[0]?.text ||
    "Unknown Playlist";

  const authorRaw =
    data?.header?.playlistHeaderRenderer?.ownerText?.runs?.[0]?.text ||
    data?.sidebar?.playlistSidebarRenderer?.items?.[0]
      ?.playlistSidebarPrimaryInfoRenderer?.videoOwnerRenderer?.title
      ?.runs?.[0]?.text ||
    "Unknown";

  const contents =
    data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer
      ?.contents?.[0]?.playlistVideoListRenderer?.contents || [];

  const videos = [];

  for (let i = 0; i < contents.length; i++) {
    const item = contents[i]?.playlistVideoRenderer;
    if (!item) continue;

    const videoId = item.videoId;
    const videoTitle = item.title?.runs?.[0]?.text || "Unknown";
    const durationText =
      item.lengthText?.simpleText ||
      item.lengthText?.runs?.[0]?.text ||
      "0:00";
    const thumbnail = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    const videoAuthor =
      item.shortBylineText?.runs?.[0]?.text || authorRaw || "Unknown";

    const parts = durationText.split(":").map(Number);
    let secs = 0;
    if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) secs = parts[0] * 60 + parts[1];

    videos.push({
      videoId,
      title: videoTitle,
      duration: durationText,
      durationSeconds: secs,
      thumbnail,
      author: videoAuthor,
      index: i + 1,
    });
  }

  const totalSeconds = videos.reduce((sum, v) => sum + v.durationSeconds, 0);
  const avgSeconds =
    videos.length > 0 ? Math.round(totalSeconds / videos.length) : 0;

  return {
    playlistId,
    title,
    author: authorRaw,
    videoCount: videos.length,
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
    return NextResponse.json({ error: "Invalid playlist URL" }, { status: 400 });
  }

  try {
    const data = await fetchPlaylistVideos(playlistId);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Playlist fetch error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to fetch playlist" },
      { status: 500 }
    );
  }
}