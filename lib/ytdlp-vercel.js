// 📁 lib/ytdlp-vercel.js
// Pure-JS YouTube data extraction for Vercel (no binary, no ytdl-core).
// Uses YouTube's internal Innertube API directly.
//
// Client strategy:
//  - ANDROID client for stream URLs → returns direct unsigned URLs (no cipher needed)
//  - TVHTML5 client as fallback for streams
//  - WEB client for metadata and playlist browsing

// ── Innertube context builders ────────────────────────────────────────────────

const ANDROID_CONTEXT = {
  client: {
    clientName: "ANDROID",
    clientVersion: "17.31.35",
    androidSdkVersion: 30,
    userAgent: "com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip",
    hl: "en",
    gl: "US",
  },
};

const WEB_CONTEXT = {
  client: {
    clientName: "WEB",
    clientVersion: "2.20231121.08.00",
    hl: "en",
    gl: "US",
  },
};

const TVHTML5_CONTEXT = {
  client: {
    clientName: "TVHTML5",
    clientVersion: "7.20230405.08.00",
    hl: "en",
    gl: "US",
  },
};

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const INNERTUBE_BASE = "https://www.youtube.com/youtubei/v1";

async function innertubePost(endpoint, body, extraHeaders = {}) {
  const res = await fetch(`${INNERTUBE_BASE}/${endpoint}?key=${INNERTUBE_KEY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Innertube ${endpoint} error: ${res.status}`);
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatViews(n) {
  if (!n) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Deep-find all values for a given key anywhere in a nested object/array. */
function findAll(obj, key, results = []) {
  if (!obj || typeof obj !== "object") return results;
  if (Array.isArray(obj)) {
    for (const item of obj) findAll(item, key, results);
    return results;
  }
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    results.push(obj[key]);
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === "object") findAll(val, key, results);
  }
  return results;
}

/** Extract plain text from a YouTube "runs" or "simpleText" text object. */
function runsText(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (typeof obj.simpleText === "string") return obj.simpleText;
  if (Array.isArray(obj.runs)) return obj.runs.map((r) => r.text || "").join("");
  return "";
}

// ── Video Info ────────────────────────────────────────────────────────────────

export async function getVideoInfo(videoId) {
  const data = await innertubePost("player", {
    context: WEB_CONTEXT,
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  });

  const status = data.playabilityStatus?.status;
  if (status && status !== "OK") {
    throw new Error(
      `Video not available: ${data.playabilityStatus?.reason || status}`
    );
  }

  const details = data.videoDetails || {};
  const microformat = data.microformat?.playerMicroformatRenderer || {};

  // Best thumbnail
  const thumbs = details.thumbnail?.thumbnails || [];
  const bestThumb =
    thumbs.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url ||
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  // Parse publish date
  const publishDateStr =
    microformat.publishDate || microformat.uploadDate || "";
  let uploadDate = "";
  let uploadDateDisplay = "";
  if (publishDateStr) {
    const d = new Date(publishDateStr);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const dy = String(d.getDate()).padStart(2, "0");
      uploadDate = `${y}${mo}${dy}`;
      uploadDateDisplay = `${y}-${mo}-${dy}`;
    }
  }

  const viewCount = parseInt(details.viewCount || "0") || 0;
  const durationSeconds = parseInt(details.lengthSeconds || "0") || 0;

  return {
    videoId,
    title: details.title || "Unknown",
    author: details.author || "Unknown",
    channelId: details.channelId || null,
    duration: formatDuration(durationSeconds),
    durationSeconds,
    thumbnail: bestThumb,
    viewCount,
    viewCountDisplay: formatViews(viewCount),
    likeCount: 0,
    uploadDate,
    uploadDateDisplay,
    description: (details.shortDescription || "").slice(0, 300),
    categories: microformat.category ? [microformat.category] : [],
    tags: (details.keywords || []).slice(0, 8),
  };
}

// ── Stream URLs ───────────────────────────────────────────────────────────────
// ANDROID client returns direct (unsigned) URLs — no cipher decoding needed.
// TVHTML5 is the fallback.

const QUALITY_HEIGHT_MAP = {
  highest: 1080,
  "1080p": 1080,
  "720p":  720,
  "480p":  480,
  "360p":  360,
  lowest:  144,
};

function mimeToExt(mimeType) {
  if (!mimeType) return "mp4";
  if (mimeType.includes("webm") || mimeType.includes("vp9") || mimeType.includes("opus"))
    return "webm";
  return "mp4";
}

function pickVideoFormat(formats, maxHeight) {
  // h264 (avc1) preferred for browser compat
  const h264 = formats
    .filter(
      (f) =>
        f.mimeType?.includes("avc1") &&
        f.url &&
        (f.height || 0) <= maxHeight
    )
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  if (h264.length) return h264[0];

  const anyVideo = formats
    .filter((f) => f.mimeType?.startsWith("video/") && f.url && (f.height || 0) <= maxHeight)
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  return anyVideo[0] || null;
}

function pickAudioFormat(formats) {
  // Prefer m4a/AAC
  const m4a = formats
    .filter((f) => f.mimeType?.includes("audio/mp4") && f.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (m4a.length) return m4a[0];

  const any = formats
    .filter((f) => f.mimeType?.startsWith("audio/") && f.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return any[0] || null;
}

export async function getStreamUrls(videoId, format, quality) {
  let data = null;
  let lastErr = null;

  // Try clients in order: ANDROID (direct URLs) → TVHTML5 → WEB
  const clients = [
    {
      context: ANDROID_CONTEXT,
      headers: {
        "User-Agent":
          "com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip",
        "X-YouTube-Client-Name": "3",
        "X-YouTube-Client-Version": "17.31.35",
      },
    },
    {
      context: TVHTML5_CONTEXT,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36",
        "X-YouTube-Client-Name": "7",
        "X-YouTube-Client-Version": "7.20230405.08.00",
      },
    },
    {
      context: WEB_CONTEXT,
      headers: {},
    },
  ];

  for (const { context, headers } of clients) {
    try {
      const res = await innertubePost(
        "player",
        { context, videoId, contentCheckOk: true, racyCheckOk: true },
        headers
      );

      const status = res.playabilityStatus?.status;
      const adaptive = res.streamingData?.adaptiveFormats || [];
      const combined = res.streamingData?.formats || [];
      const hasDirectUrls =
        [...adaptive, ...combined].some((f) => !!f.url);

      if (status === "OK" && hasDirectUrls) {
        data = res;
        break;
      }

      lastErr = new Error(
        `${status}: ${res.playabilityStatus?.reason || "no direct URLs"}`
      );
    } catch (err) {
      lastErr = err;
    }
  }

  if (!data) {
    throw lastErr || new Error("Failed to fetch stream data from all clients");
  }

  const adaptive = data.streamingData?.adaptiveFormats || [];
  const combined = data.streamingData?.formats || [];
  const details = data.videoDetails || {};
  const durationSeconds = parseInt(details.lengthSeconds || "0") || 0;

  const safeName = (details.title || `media_${videoId}`)
    .replace(/[^\w\s\-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 100);

  if (format === "mp3") {
    const audioFmt = pickAudioFormat(adaptive);
    if (!audioFmt?.url) throw new Error("No audio stream URL found");
    const ext = mimeToExt(audioFmt.mimeType);
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
      videoExt: ext,
      audioExt: ext,
      durationSeconds,
    };
  }

  const maxHeight = QUALITY_HEIGHT_MAP[quality] || 1080;
  const videoFmt = pickVideoFormat(adaptive, maxHeight);
  const audioFmt = pickAudioFormat(adaptive);

  if (videoFmt?.url && audioFmt?.url) {
    const videoExt = mimeToExt(videoFmt.mimeType);
    const audioExt = mimeToExt(audioFmt.mimeType);
    console.log(
      `[innertube] video: ${videoFmt.height}p ${videoFmt.mimeType} | audio: ${audioFmt.mimeType}`
    );
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

  // Fallback to combined format
  const bestCombined = combined
    .filter((f) => f.url && (f.height || 0) <= maxHeight)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0];

  if (bestCombined?.url) {
    const ext = mimeToExt(bestCombined.mimeType);
    return {
      videoId,
      title: details.title || "Unknown",
      filename: safeName,
      format,
      quality,
      streamType: "single",
      url: bestCombined.url,
      videoUrl: null,
      audioUrl: null,
      videoExt: ext,
      audioExt: ext,
      durationSeconds,
    };
  }

  throw new Error(
    "No stream URLs found — video may be age-restricted or unavailable"
  );
}

// ── Playlist ──────────────────────────────────────────────────────────────────

const UNAVAILABLE_TITLES = new Set([
  "[private video]",
  "[deleted video]",
  "[unavailable]",
]);

/** Extract all playlistVideoRenderer entries from a browse response. */
function extractPlaylistVideos(data) {
  const renderers = findAll(data, "playlistVideoRenderer");
  const videos = [];

  for (const r of renderers) {
    const videoId = r.videoId;
    if (!videoId) continue;

    const title = runsText(r.title) || "Unknown";
    if (UNAVAILABLE_TITLES.has(title.toLowerCase().trim())) continue;

    // Duration: prefer lengthSeconds (integer), fall back to lengthText ("4:32")
    let durationSeconds = 0;
    if (r.lengthSeconds) {
      durationSeconds = parseInt(r.lengthSeconds) || 0;
    } else if (r.lengthText) {
      const text = runsText(r.lengthText);
      const parts = text.split(":").map(Number);
      if (parts.length === 3)
        durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2)
        durationSeconds = parts[0] * 60 + parts[1];
    }

    const author = runsText(r.shortBylineText) || "Unknown";

    videos.push({ videoId, title, durationSeconds, author });
  }

  return videos;
}

/**
 * Extract continuation token from a browse response.
 * Looks for continuationCommand.token inside continuationItemRenderer.
 */
function extractContinuationToken(data) {
  // Look for the specific path: continuationItemRenderer → continuationEndpoint → continuationCommand → token
  const items = findAll(data, "continuationItemRenderer");
  for (const item of items) {
    const token =
      item?.continuationEndpoint?.continuationCommand?.token ||
      item?.button?.buttonRenderer?.command?.continuationCommand?.token;
    if (token && typeof token === "string" && token.length > 50) return token;
  }
  return null;
}

/** Extract playlist title and author. */
function extractPlaylistMeta(data) {
  // playlistHeaderRenderer (most reliable for playlists)
  const headers = findAll(data, "playlistHeaderRenderer");
  if (headers.length) {
    const h = headers[0];
    const title = runsText(h.title) || "Unknown Playlist";
    const author =
      runsText(h.ownerText) ||
      runsText(h.subtitle) ||
      runsText(h.byline) ||
      "Unknown";
    return { title, author };
  }

  // Sidebar
  const sidebarPrimary = findAll(data, "playlistSidebarPrimaryInfoRenderer");
  if (sidebarPrimary.length) {
    const s = sidebarPrimary[0];
    const title = runsText(s.title) || "Unknown Playlist";
    const sidebarSecondary = findAll(data, "playlistSidebarSecondaryInfoRenderer");
    const author = sidebarSecondary.length
      ? runsText(sidebarSecondary[0].videoOwner?.videoOwnerRenderer?.title) || "Unknown"
      : "Unknown";
    return { title, author };
  }

  // Metadata renderer
  const meta = findAll(data, "playlistMetadataRenderer");
  if (meta.length) return { title: meta[0].title || "Unknown Playlist", author: "Unknown" };

  return { title: "Unknown Playlist", author: "Unknown" };
}

export async function getPlaylistInfo(playlistId) {
  let data = await innertubePost("browse", {
    context: WEB_CONTEXT,
    browseId: `VL${playlistId}`,
  });

  const meta = extractPlaylistMeta(data);
  let allVideos = extractPlaylistVideos(data);

  // Follow continuation pages (max 20 = ~4000 videos)
  let pageCount = 0;
  const usedTokens = new Set();

  while (pageCount < 20) {
    const token = extractContinuationToken(data);
    if (!token || usedTokens.has(token)) break;
    usedTokens.add(token);

    try {
      data = await innertubePost("browse", {
        context: WEB_CONTEXT,
        continuation: token,
      });
    } catch (err) {
      console.warn("[playlist] continuation fetch failed:", err.message);
      break;
    }

    const more = extractPlaylistVideos(data);
    if (more.length === 0) break;
    allVideos = allVideos.concat(more);
    pageCount++;
  }

  // Deduplicate
  const seen = new Set();
  const videos = [];
  let idx = 1;
  for (const item of allVideos) {
    if (seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    videos.push({
      videoId: item.videoId,
      title: item.title,
      duration: formatDuration(item.durationSeconds),
      durationSeconds: item.durationSeconds,
      thumbnail: `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`,
      author:
        item.author && item.author !== "Unknown" ? item.author : meta.author,
      index: idx++,
      viewCount: 0,
      uploadDate: "",
      uploadDateDisplay: "",
    });
  }

  const totalSeconds = videos.reduce((s, v) => s + v.durationSeconds, 0);
  const avgSeconds =
    videos.length > 0 ? Math.round(totalSeconds / videos.length) : 0;

  return {
    playlistId,
    title: meta.title,
    author: meta.author,
    videoCount: videos.length,
    unavailableCount: 0,
    videos,
    totalDuration: formatDuration(totalSeconds),
    totalSeconds,
    averageDuration: formatDuration(avgSeconds),
    averageSeconds: avgSeconds,
  };
}