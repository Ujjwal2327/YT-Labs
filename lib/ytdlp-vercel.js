// 📁 lib/ytdlp-vercel.js
// Pure-JS YouTube extraction for Vercel — uses Innertube API directly.
// No binary, no ytdl-core, no API key required.
//
// Clients used:
//   IOS          — video info + stream URLs (bypasses bot check, returns direct URLs)
//   WEB_EMBEDDED — fallback for stream URLs
//   WEB          — playlist browsing only

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const BASE = "https://www.youtube.com/youtubei/v1";

// ── Client contexts ───────────────────────────────────────────────────────────

const IOS_CTX = {
  client: {
    clientName: "IOS",
    clientVersion: "17.33.2",
    deviceModel: "iPhone14,3",
    userAgent:
      "com.google.ios.youtube/17.33.2 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)",
    hl: "en",
    gl: "US",
  },
};

const ANDROID_CTX = {
  client: {
    clientName: "ANDROID",
    clientVersion: "17.31.35",
    androidSdkVersion: 30,
    userAgent:
      "com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip",
    hl: "en",
    gl: "US",
  },
};

const WEB_EMBED_CTX = {
  client: {
    clientName: "WEB_EMBEDDED_PLAYER",
    clientVersion: "1.20220731.00.00",
    hl: "en",
    gl: "US",
  },
};

const WEB_CTX = {
  client: {
    clientName: "WEB",
    clientVersion: "2.20240101.00.00",
    hl: "en",
    gl: "US",
  },
};

// ── Core fetch ────────────────────────────────────────────────────────────────

async function innertube(endpoint, body, extraHeaders = {}) {
  const url = `${BASE}/${endpoint}?prettyPrint=false`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": INNERTUBE_KEY,
      Origin: "https://www.youtube.com",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Innertube /${endpoint} → HTTP ${res.status}`);
  return res.json();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmt(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtViews(n) {
  if (!n) return null;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

/** Extract plain text from YouTube's text objects (runs or simpleText). */
function txt(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj.simpleText) return obj.simpleText;
  if (Array.isArray(obj.runs)) return obj.runs.map((r) => r.text || "").join("");
  return "";
}

/**
 * Recursively collect every value stored under `key` anywhere in obj.
 * Works correctly on mixed object/array trees.
 */
function findAll(obj, key, out = []) {
  if (obj === null || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    for (const v of obj) findAll(v, key, out);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === key) out.push(v);
    if (v && typeof v === "object") findAll(v, key, out);
  }
  return out;
}

// ── Video info ────────────────────────────────────────────────────────────────

export async function getVideoInfo(videoId) {
  // Try IOS first (no bot check, full metadata), fall back to ANDROID
  let data = null;
  let lastErr = null;

  for (const [ctx, headers] of [
    [IOS_CTX,     { "User-Agent": "com.google.ios.youtube/17.33.2 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)" }],
    [ANDROID_CTX, { "User-Agent": "com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip" }],
    [WEB_CTX,     {}],
  ]) {
    try {
      const res = await innertube(
        "player",
        { context: ctx, videoId, contentCheckOk: true, racyCheckOk: true },
        headers
      );
      const status = res.playabilityStatus?.status;
      if (status === "OK" || status === "CONTENT_CHECK_REQUIRED") {
        data = res;
        break;
      }
      lastErr = new Error(res.playabilityStatus?.reason || `status: ${status}`);
    } catch (e) {
      lastErr = e;
    }
  }

  if (!data) throw lastErr || new Error("All clients failed for video info");

  const d = data.videoDetails || {};
  const mf = data.microformat?.playerMicroformatRenderer || {};

  // Thumbnails — highest res first
  const thumbs = (d.thumbnail?.thumbnails || []).sort(
    (a, b) => (b.width || 0) - (a.width || 0)
  );
  const thumb =
    thumbs[0]?.url ||
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  // Upload date
  const dateStr = mf.publishDate || mf.uploadDate || "";
  let uploadDate = "";
  let uploadDateDisplay = "";
  if (dateStr) {
    const dt = new Date(dateStr);
    if (!isNaN(dt)) {
      const y = dt.getFullYear();
      const mo = String(dt.getMonth() + 1).padStart(2, "0");
      const dy = String(dt.getDate()).padStart(2, "0");
      uploadDate = `${y}${mo}${dy}`;
      uploadDateDisplay = `${y}-${mo}-${dy}`;
    }
  }

  const viewCount = parseInt(d.viewCount || "0") || 0;
  const durationSeconds = parseInt(d.lengthSeconds || "0") || 0;

  return {
    videoId,
    title: d.title || "Unknown",
    author: d.author || "Unknown",
    channelId: d.channelId || null,
    duration: fmt(durationSeconds),
    durationSeconds,
    thumbnail: thumb,
    viewCount,
    viewCountDisplay: fmtViews(viewCount),
    likeCount: 0,
    uploadDate,
    uploadDateDisplay,
    description: (d.shortDescription || "").slice(0, 300),
    categories: mf.category ? [mf.category] : [],
    tags: (d.keywords || []).slice(0, 8),
  };
}

// ── Stream URLs ───────────────────────────────────────────────────────────────

const HEIGHT_MAP = {
  highest: 1080,
  "1080p": 1080,
  "720p":  720,
  "480p":  480,
  "360p":  360,
  lowest:  144,
};

function ext(mimeType = "") {
  return mimeType.includes("webm") ? "webm" : "mp4";
}

function bestVideo(formats, maxH) {
  // Prefer avc1/h264 for max browser compat
  const h264 = formats
    .filter((f) => f.url && f.mimeType?.includes("avc1") && (f.height || 0) <= maxH)
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  if (h264.length) return h264[0];

  return (
    formats
      .filter((f) => f.url && f.mimeType?.startsWith("video/") && (f.height || 0) <= maxH)
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0] || null
  );
}

function bestAudio(formats) {
  // Prefer m4a/AAC (mp4 container) for broadest compat with ffmpeg.wasm
  const m4a = formats
    .filter((f) => f.url && f.mimeType?.includes("audio/mp4"))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (m4a.length) return m4a[0];

  return (
    formats
      .filter((f) => f.url && f.mimeType?.startsWith("audio/"))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] || null
  );
}

export async function getStreamUrls(videoId, format, quality) {
  let data = null;
  let lastErr = null;

  // IOS and ANDROID clients return direct (unsigned) CDN URLs — no cipher needed.
  for (const [ctx, headers] of [
    [IOS_CTX,      { "User-Agent": "com.google.ios.youtube/17.33.2 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)" }],
    [ANDROID_CTX,  { "User-Agent": "com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip" }],
    [WEB_EMBED_CTX, {}],
  ]) {
    try {
      const res = await innertube(
        "player",
        { context: ctx, videoId, contentCheckOk: true, racyCheckOk: true },
        headers
      );
      const status = res.playabilityStatus?.status;
      const af = res.streamingData?.adaptiveFormats || [];
      const cf = res.streamingData?.formats || [];
      const hasUrls = [...af, ...cf].some((f) => !!f.url);

      if ((status === "OK" || status === "CONTENT_CHECK_REQUIRED") && hasUrls) {
        data = res;
        break;
      }
      lastErr = new Error(res.playabilityStatus?.reason || `status: ${status}`);
    } catch (e) {
      lastErr = e;
    }
  }

  if (!data) throw lastErr || new Error("Could not retrieve stream URLs");

  const adaptive = data.streamingData?.adaptiveFormats || [];
  const combined = data.streamingData?.formats || [];
  const d = data.videoDetails || {};
  const dur = parseInt(d.lengthSeconds || "0") || 0;

  const safeName = (d.title || `media_${videoId}`)
    .replace(/[^\w\s\-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 100);

  // ── Audio only (MP3) ────────────────────────────────────────────────────────
  if (format === "mp3") {
    const af = bestAudio(adaptive);
    if (!af?.url) throw new Error("No audio stream URL found");
    return {
      videoId,
      title: d.title || "Unknown",
      filename: safeName,
      format,
      quality,
      streamType: "single",
      url: af.url,
      videoUrl: null,
      audioUrl: null,
      videoExt: ext(af.mimeType),
      audioExt: ext(af.mimeType),
      durationSeconds: dur,
    };
  }

  // ── Video + Audio (MP4) — dual stream preferred ─────────────────────────────
  const maxH = HEIGHT_MAP[quality] || 1080;
  const vf = bestVideo(adaptive, maxH);
  const af = bestAudio(adaptive);

  if (vf?.url && af?.url) {
    console.log(`[innertube] video ${vf.height}p ${vf.mimeType} | audio ${af.mimeType}`);
    return {
      videoId,
      title: d.title || "Unknown",
      filename: safeName,
      format,
      quality,
      streamType: "dual",
      url: null,
      videoUrl: vf.url,
      audioUrl: af.url,
      videoExt: ext(vf.mimeType),
      audioExt: ext(af.mimeType),
      durationSeconds: dur,
    };
  }

  // ── Fallback: combined stream ───────────────────────────────────────────────
  const cf2 = combined
    .filter((f) => f.url && (f.height || 0) <= maxH)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0];

  if (cf2?.url) {
    return {
      videoId,
      title: d.title || "Unknown",
      filename: safeName,
      format,
      quality,
      streamType: "single",
      url: cf2.url,
      videoUrl: null,
      audioUrl: null,
      videoExt: ext(cf2.mimeType),
      audioExt: ext(cf2.mimeType),
      durationSeconds: dur,
    };
  }

  throw new Error("No stream URLs found — video may be restricted or unavailable");
}

// ── Playlist ──────────────────────────────────────────────────────────────────

const UNAVAILABLE = new Set(["[private video]", "[deleted video]", "[unavailable]"]);

/**
 * Parse playlist videos from an initial browse response OR a continuation response.
 * Initial:      data.contents.twoColumnBrowseResultsRenderer...playlistVideoListRenderer.contents
 * Continuation: data.onResponseReceivedActions[].appendContinuationItemsAction.continuationItems
 */
function parseVideos(data) {
  // Use findAll to get every playlistVideoRenderer regardless of nesting depth
  const renderers = findAll(data, "playlistVideoRenderer");
  const out = [];

  for (const r of renderers) {
    if (!r.videoId) continue;
    const title = txt(r.title) || "Unknown";
    if (UNAVAILABLE.has(title.toLowerCase().trim())) continue;

    let secs = 0;
    if (r.lengthSeconds) {
      secs = parseInt(r.lengthSeconds) || 0;
    } else if (r.lengthText) {
      const parts = txt(r.lengthText).split(":").map(Number);
      if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
    }

    out.push({
      videoId: r.videoId,
      title,
      durationSeconds: secs,
      author: txt(r.shortBylineText) || "Unknown",
    });
  }

  return out;
}

/**
 * Find the continuation token in either an initial browse or continuation response.
 * Path in initial:      ...continuationItemRenderer.continuationEndpoint.continuationCommand.token
 * Path in continuation: same, inside appendContinuationItemsAction.continuationItems
 */
function getToken(data) {
  const items = findAll(data, "continuationItemRenderer");
  for (const item of items) {
    const token =
      item?.continuationEndpoint?.continuationCommand?.token ||
      item?.button?.buttonRenderer?.command?.continuationCommand?.token;
    if (typeof token === "string" && token.length > 40) return token;
  }
  return null;
}

/** Extract playlist title + author from the initial browse response. */
function getMeta(data) {
  // playlistHeaderRenderer is in data.header
  const headers = findAll(data, "playlistHeaderRenderer");
  if (headers.length) {
    const h = headers[0];
    return {
      title: txt(h.title) || "Unknown Playlist",
      author:
        txt(h.ownerText) ||
        txt(h.subtitle) ||
        "Unknown",
    };
  }

  // Sidebar fallback
  const sidebar = findAll(data, "playlistSidebarPrimaryInfoRenderer");
  if (sidebar.length) {
    return {
      title: txt(sidebar[0].title) || "Unknown Playlist",
      author: "Unknown",
    };
  }

  return { title: "Unknown Playlist", author: "Unknown" };
}

export async function getPlaylistInfo(playlistId) {
  // Initial browse
  let data = await innertube("browse", {
    context: WEB_CTX,
    browseId: `VL${playlistId}`,
  });

  const meta = getMeta(data);
  let all = parseVideos(data);

  // Follow continuations (max 25 pages ≈ 5000 videos)
  const seen = new Set();
  let pages = 0;

  while (pages < 25) {
    const token = getToken(data);
    if (!token || seen.has(token)) break;
    seen.add(token);

    try {
      data = await innertube("browse", {
        context: WEB_CTX,
        continuation: token,
      });
    } catch (e) {
      console.warn("[playlist continuation]", e.message);
      break;
    }

    const more = parseVideos(data);
    if (!more.length) break;
    all = all.concat(more);
    pages++;
  }

  // Deduplicate by videoId
  const dedupSeen = new Set();
  const videos = [];
  let idx = 1;
  for (const v of all) {
    if (dedupSeen.has(v.videoId)) continue;
    dedupSeen.add(v.videoId);
    videos.push({
      videoId: v.videoId,
      title: v.title,
      duration: fmt(v.durationSeconds),
      durationSeconds: v.durationSeconds,
      thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
      author: v.author !== "Unknown" ? v.author : meta.author,
      index: idx++,
      viewCount: 0,
      uploadDate: "",
      uploadDateDisplay: "",
    });
  }

  const totalSecs = videos.reduce((s, v) => s + v.durationSeconds, 0);
  const avgSecs = videos.length ? Math.round(totalSecs / videos.length) : 0;

  return {
    playlistId,
    title: meta.title,
    author: meta.author,
    videoCount: videos.length,
    unavailableCount: 0,
    videos,
    totalDuration: fmt(totalSecs),
    totalSeconds: totalSecs,
    averageDuration: fmt(avgSecs),
    averageSeconds: avgSecs,
  };
}