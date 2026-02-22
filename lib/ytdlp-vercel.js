// 📁 lib/ytdlp-vercel.js
// Pure-JS YouTube extraction for Vercel deployments where yt-dlp binary is unavailable.
// Uses @distube/ytdl-core (no binary needed) for video info and stream URLs.
// For playlists, uses YouTube's public data (innertube API via ytdl-core internals).

import ytdl from "@distube/ytdl-core";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Video Info ────────────────────────────────────────────────────────────────

export async function getVideoInfo(videoId) {
  const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
  const details = info.videoDetails;

  const thumbs = details.thumbnails || [];
  const bestThumb =
    thumbs.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url ||
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  // Parse upload date from publishDate (ISO string) or uploadDate
  const publishDate = details.publishDate || details.uploadDate || "";
  let uploadDate = "";
  let uploadDateDisplay = "";
  if (publishDate) {
    const d = new Date(publishDate);
    if (!isNaN(d)) {
      uploadDate = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      uploadDateDisplay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }

  const viewCount = parseInt(details.viewCount || "0");

  return {
    videoId,
    title: details.title || "Unknown",
    author: details.author?.name || details.ownerChannelName || "Unknown",
    channelId: details.channelId || details.author?.id || null,
    duration: formatDuration(parseInt(details.lengthSeconds || "0")),
    durationSeconds: parseInt(details.lengthSeconds || "0"),
    thumbnail: bestThumb,
    viewCount,
    viewCountDisplay: formatViews(viewCount),
    likeCount: 0, // not available without API key
    uploadDate,
    uploadDateDisplay,
    description: (details.description || "").slice(0, 300),
    categories: details.category ? [details.category] : [],
    tags: (details.keywords || []).slice(0, 8),
  };
}

// ── Stream URLs ───────────────────────────────────────────────────────────────

// Quality preference: prefer h264 (avc1) for browser compat, cap at 1080p for device mode.
const QUALITY_HEIGHT_MAP = {
  highest: 1080,
  "1080p": 1080,
  "720p":  720,
  "480p":  480,
  "360p":  360,
  lowest:  144,
};

function pickVideoFormat(formats, maxHeight) {
  // Prefer avc1 (h264) up to maxHeight
  const h264 = formats
    .filter(f => f.hasVideo && !f.hasAudio && f.codecs?.startsWith("avc1") && (f.height || 0) <= maxHeight)
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  if (h264.length) return h264[0];

  // Fallback: any video-only up to maxHeight
  const anyVideo = formats
    .filter(f => f.hasVideo && !f.hasAudio && (f.height || 0) <= maxHeight)
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  if (anyVideo.length) return anyVideo[0];

  return null;
}

function pickAudioFormat(formats) {
  // Prefer m4a/mp4 container (AAC) for broadest compat
  const m4a = formats
    .filter(f => !f.hasVideo && f.hasAudio && f.container === "mp4")
    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
  if (m4a.length) return m4a[0];

  // Fallback: any audio
  const any = formats
    .filter(f => !f.hasVideo && f.hasAudio)
    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
  return any[0] || null;
}

export async function getStreamUrls(videoId, format, quality) {
  const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
  const details = info.videoDetails;
  const formats = info.formats;

  const safeName = (details.title || `media_${videoId}`)
    .replace(/[^\w\s\-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 100);

  const durationSeconds = parseInt(details.lengthSeconds || "0");

  if (format === "mp3") {
    const audioFmt = pickAudioFormat(formats);
    if (!audioFmt?.url) throw new Error("No audio stream found");

    return {
      videoId,
      title: details.title || "Unknown",
      filename: safeName,
      format,
      quality,
      streamType: "single",
      url: audioFmt.url,
      videoUrl: null,
      audioUrl: null,
      videoExt: audioFmt.container || "m4a",
      audioExt: audioFmt.container || "m4a",
      durationSeconds,
    };
  }

  // MP4: dual stream (separate video + audio)
  const maxHeight = QUALITY_HEIGHT_MAP[quality] || 1080;
  const videoFmt = pickVideoFormat(formats, maxHeight);
  const audioFmt = pickAudioFormat(formats);

  if (videoFmt && audioFmt) {
    const videoExt = videoFmt.container || "mp4";
    const audioExt = audioFmt.container || "m4a";

    console.log(`[ytdl-core] video: ${videoFmt.height}p ${videoFmt.codecs} ext=${videoExt}`);
    console.log(`[ytdl-core] audio: ${audioFmt.audioBitrate}kbps ext=${audioExt}`);

    return {
      videoId,
      title: details.title || "Unknown",
      filename: safeName,
      format,
      quality,
      streamType: "dual",
      url: null,
      videoUrl: videoFmt.url,
      audioUrl: audioFmt.url,
      videoExt,
      audioExt,
      durationSeconds,
    };
  }

  // Fallback: find best combined format
  const combined = formats
    .filter(f => f.hasVideo && f.hasAudio && (f.height || 0) <= maxHeight)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  if (combined.length) {
    const fmt = combined[0];
    return {
      videoId,
      title: details.title || "Unknown",
      filename: safeName,
      format,
      quality,
      streamType: "single",
      url: fmt.url,
      videoUrl: null,
      audioUrl: null,
      videoExt: fmt.container || "mp4",
      audioExt: fmt.container || "mp4",
      durationSeconds,
    };
  }

  throw new Error("No suitable stream formats found");
}

// ── Playlist (via YouTube innertube/browse API — no API key needed) ───────────

const UNAVAILABLE_TITLES = new Set([
  "[private video]",
  "[deleted video]",
  "[unavailable]",
]);

async function fetchPlaylistPage(playlistId, continuation = null) {
  // Use YouTube's internal browse API (same as ytdl-core uses internally)
  const body = continuation
    ? {
        context: {
          client: { clientName: "WEB", clientVersion: "2.20231121.08.00" },
        },
        continuation,
      }
    : {
        context: {
          client: { clientName: "WEB", clientVersion: "2.20231121.08.00" },
        },
        browseId: `VL${playlistId}`,
      };

  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/browse?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) throw new Error(`YouTube browse API error: ${res.status}`);
  return res.json();
}

function parsePlaylistItems(data) {
  const items = [];

  // Navigate the deeply nested response structure
  const tabs =
    data?.header?.playlistHeaderRenderer ||
    data?.contents?.twoColumnBrowseResultsRenderer?.tabs;

  // Parse videos from playlistVideoListRenderer
  function extractFromRenderer(obj) {
    if (!obj || typeof obj !== "object") return;

    if (obj.playlistVideoRenderer) {
      const r = obj.playlistVideoRenderer;
      const videoId = r.videoId;
      if (!videoId) return;

      const titleRuns = r.title?.runs || [];
      const title = titleRuns.map(t => t.text).join("") || r.title?.simpleText || "Unknown";

      if (UNAVAILABLE_TITLES.has(title.toLowerCase().trim())) return;

      const lengthText = r.lengthText?.simpleText || "0:00";
      const parts = lengthText.split(":").map(Number);
      let secs = 0;
      if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) secs = parts[0] * 60 + parts[1];

      const authorRuns = r.shortBylineText?.runs || [];
      const author = authorRuns.map(t => t.text).join("") || "Unknown";

      items.push({ videoId, title, durationSeconds: secs, author });
      return;
    }

    // Recurse into arrays and objects
    for (const key of Object.keys(obj)) {
      if (key === "playlistVideoRenderer") continue; // already handled
      const val = obj[key];
      if (Array.isArray(val)) val.forEach(extractFromRenderer);
      else if (val && typeof val === "object") extractFromRenderer(val);
    }
  }

  extractFromRenderer(data);
  return items;
}

function getContinuationToken(data) {
  // Find continuationItemRenderer → continuationEndpoint → continuationCommand → token
  function find(obj) {
    if (!obj || typeof obj !== "object") return null;
    if (obj.continuationItemRenderer) {
      return (
        obj.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || null
      );
    }
    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          const r = find(item);
          if (r) return r;
        }
      } else if (val && typeof val === "object") {
        const r = find(val);
        if (r) return r;
      }
    }
    return null;
  }
  return find(data);
}

function getPlaylistMeta(data) {
  const header = data?.header?.playlistHeaderRenderer;
  if (header) {
    const titleRuns = header.title?.runs || [];
    const title = titleRuns.map(t => t.text).join("") || header.title?.simpleText || "Unknown Playlist";
    const ownerRuns = header.ownerText?.runs || [];
    const author = ownerRuns.map(t => t.text).join("") || "Unknown";
    return { title, author };
  }
  // Fallback: sidebar
  const sidebar = data?.sidebar?.playlistSidebarRenderer?.items;
  if (sidebar?.[0]?.playlistSidebarPrimaryInfoRenderer) {
    const r = sidebar[0].playlistSidebarPrimaryInfoRenderer;
    const title = r.title?.runs?.map(t => t.text).join("") || "Unknown Playlist";
    return { title, author: "Unknown" };
  }
  return { title: "Unknown Playlist", author: "Unknown" };
}

export async function getPlaylistInfo(playlistId) {
  const formatDur = formatDuration;

  // Fetch first page
  let data = await fetchPlaylistPage(playlistId);
  const meta = getPlaylistMeta(data);
  let allItems = parsePlaylistItems(data);

  // Fetch continuation pages (up to 10 pages = ~2000 videos, enough for most playlists)
  let token = getContinuationToken(data);
  let page = 0;
  while (token && page < 10) {
    data = await fetchPlaylistPage(playlistId, token);
    const more = parsePlaylistItems(data);
    allItems = allItems.concat(more);
    token = getContinuationToken(data);
    page++;
  }

  // Deduplicate by videoId
  const seen = new Set();
  const videos = [];
  let idx = 1;
  for (const item of allItems) {
    if (seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    videos.push({
      videoId: item.videoId,
      title: item.title,
      duration: formatDur(item.durationSeconds),
      durationSeconds: item.durationSeconds,
      thumbnail: `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`,
      author: item.author || meta.author,
      index: idx++,
      viewCount: 0,
      uploadDate: "",
      uploadDateDisplay: "",
    });
  }

  const totalSeconds = videos.reduce((s, v) => s + v.durationSeconds, 0);
  const avgSeconds = videos.length > 0 ? Math.round(totalSeconds / videos.length) : 0;

  return {
    playlistId,
    title: meta.title,
    author: meta.author,
    videoCount: videos.length,
    unavailableCount: 0,
    videos,
    totalDuration: formatDur(totalSeconds),
    totalSeconds,
    averageDuration: formatDur(avgSeconds),
    averageSeconds: avgSeconds,
  };
}