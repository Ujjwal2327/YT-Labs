// 📁 lib/ytdlp-vercel.js
// Pure-JS YouTube extraction for Vercel (no binary, no ytdl-core).
//
// KEY INSIGHT: YouTube's /youtubei/v1/player endpoint is bot-checked on
// AWS/Vercel datacenter IPs regardless of client. So we NEVER use it for
// metadata. Instead:
//
//   Video info  → oEmbed API + watch page <meta> tags  (always public, never blocked)
//   Playlist    → Innertube /browse endpoint            (public data, not bot-checked)
//   Stream URLs → Innertube /player with IOS client    (mobile clients bypass bot-check)

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const BASE = "https://www.youtube.com/youtubei/v1";

// ── Innertube contexts ────────────────────────────────────────────────────────

const IOS_CTX = {
  client: {
    clientName: "IOS",
    clientVersion: "17.33.2",
    deviceModel: "iPhone14,3",
    userAgent: "com.google.ios.youtube/17.33.2 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)",
    hl: "en",
    gl: "US",
  },
};

const ANDROID_CTX = {
  client: {
    clientName: "ANDROID",
    clientVersion: "17.31.35",
    androidSdkVersion: 30,
    userAgent: "com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip",
    hl: "en",
    gl: "US",
  },
};

const TVHTML5_CTX = {
  client: {
    clientName: "TVHTML5",
    clientVersion: "7.20230405.08.00",
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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function txt(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj.simpleText) return obj.simpleText;
  if (Array.isArray(obj.runs)) return obj.runs.map((r) => r.text || "").join("");
  return "";
}

function findAll(obj, key, out = []) {
  if (!obj || typeof obj !== "object") return out;
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

async function innertubePost(endpoint, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}/${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": INNERTUBE_KEY,
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Innertube /${endpoint} HTTP ${res.status}`);
  return res.json();
}

// ── ISO 8601 duration parser (PT4M32S → 272 seconds) ─────────────────────────
function parseISO8601Duration(str) {
  if (!str) return 0;
  const m = str.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

// ── Video Info ────────────────────────────────────────────────────────────────
// Uses oEmbed (title, author, thumbnail) + watch page meta tags (duration, views, date).
// Neither endpoint is behind bot-check — they're public HTTP pages/APIs.

export async function getVideoInfo(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // 1. oEmbed — fast, always works, gives title + author + thumbnail
  let title = "Unknown";
  let author = "Unknown";
  let thumbnail = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  try {
    const oe = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`
    );
    if (oe.ok) {
      const j = await oe.json();
      title = j.title || title;
      author = j.author_name || author;
      thumbnail = j.thumbnail_url || thumbnail;
    }
  } catch (_) {}

  // 2. Watch page HTML — parse <meta> tags for duration, view count, upload date
  let durationSeconds = 0;
  let viewCount = 0;
  let uploadDate = "";
  let uploadDateDisplay = "";
  let channelId = null;
  let description = "";
  let tags = [];

  try {
    const pageRes = await fetch(watchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (pageRes.ok) {
      // Only read first 100 KB — all meta tags are in <head>
      const reader = pageRes.body.getReader();
      let html = "";
      let bytesRead = 0;
      while (bytesRead < 100_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += new TextDecoder().decode(value);
        bytesRead += value.length;
        // Stop once we've passed </head>
        if (html.includes("</head>")) break;
      }
      reader.cancel().catch(() => {});

      // <meta itemprop="duration" content="PT4M32S">
      const durMatch = html.match(/itemprop="duration"\s+content="([^"]+)"/);
      if (durMatch) durationSeconds = parseISO8601Duration(durMatch[1]);

      // <meta itemprop="interactionCount" content="12345678">
      const viewMatch = html.match(/itemprop="interactionCount"\s+content="([^"]+)"/);
      if (viewMatch) viewCount = parseInt(viewMatch[1]) || 0;

      // <meta itemprop="datePublished" content="2023-01-15">
      const dateMatch = html.match(/itemprop="datePublished"\s+content="([^"]+)"/);
      if (dateMatch) {
        const d = dateMatch[1].replace(/-/g, "");
        uploadDate = d;
        uploadDateDisplay = dateMatch[1];
      }

      // ytInitialPlayerResponse for channelId and description
      const initMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.{0,5000}?"videoDetails")/);
      if (initMatch) {
        try {
          // Extract channelId
          const chMatch = initMatch[0].match(/"channelId"\s*:\s*"([^"]+)"/);
          if (chMatch) channelId = chMatch[1];

          // Extract short description
          const descMatch = initMatch[0].match(/"shortDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (descMatch) {
            description = descMatch[1]
              .replace(/\\n/g, "\n")
              .replace(/\\"/g, '"')
              .slice(0, 300);
          }
        } catch (_) {}
      }

      // Keywords
      const kwMatch = html.match(/<meta name="keywords" content="([^"]+)"/);
      if (kwMatch) tags = kwMatch[1].split(",").map((t) => t.trim()).slice(0, 8);
    }
  } catch (e) {
    console.warn("[getVideoInfo] page parse failed:", e.message);
  }

  return {
    videoId,
    title,
    author,
    channelId,
    duration: fmt(durationSeconds),
    durationSeconds,
    thumbnail,
    viewCount,
    viewCountDisplay: fmtViews(viewCount),
    likeCount: 0,
    uploadDate,
    uploadDateDisplay,
    description,
    categories: [],
    tags,
  };
}

// ── Stream URLs ───────────────────────────────────────────────────────────────
// IOS + ANDROID clients have the best track record for returning direct URLs
// from non-residential IPs because they're treated as mobile app requests.

const HEIGHT_MAP = {
  highest: 1080,
  "1080p": 1080,
  "720p":  720,
  "480p":  480,
  "360p":  360,
  lowest:  144,
};

function mimeExt(mimeType = "") {
  return mimeType.includes("webm") ? "webm" : "mp4";
}

function pickVideo(formats, maxH) {
  const h264 = formats
    .filter((f) => f.url && f.mimeType?.includes("avc1") && (f.height || 0) <= maxH)
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  if (h264.length) return h264[0];

  return (
    formats
      .filter((f) => f.url && f.mimeType?.startsWith("video/") && (f.height || 0) <= maxH)
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0] ?? null
  );
}

function pickAudio(formats) {
  const m4a = formats
    .filter((f) => f.url && f.mimeType?.includes("audio/mp4"))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (m4a.length) return m4a[0];

  return (
    formats
      .filter((f) => f.url && f.mimeType?.startsWith("audio/"))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] ?? null
  );
}

export async function getStreamUrls(videoId, format, quality) {
  let streamData = null;
  let lastErr = null;

  const attempts = [
    {
      ctx: IOS_CTX,
      headers: {
        "User-Agent": "com.google.ios.youtube/17.33.2 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)",
        "X-YouTube-Client-Name": "5",
        "X-YouTube-Client-Version": "17.33.2",
      },
    },
    {
      ctx: ANDROID_CTX,
      headers: {
        "User-Agent": "com.google.android.youtube/17.31.35 (Linux; U; Android 11) gzip",
        "X-YouTube-Client-Name": "3",
        "X-YouTube-Client-Version": "17.31.35",
      },
    },
    {
      ctx: TVHTML5_CTX,
      headers: {
        "User-Agent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36",
        "X-YouTube-Client-Name": "7",
        "X-YouTube-Client-Version": "7.20230405.08.00",
      },
    },
  ];

  for (const { ctx, headers } of attempts) {
    try {
      const res = await innertubePost(
        "player",
        { context: ctx, videoId, contentCheckOk: true, racyCheckOk: true },
        headers
      );
      const status = res.playabilityStatus?.status;
      const adaptive = res.streamingData?.adaptiveFormats || [];
      const combined = res.streamingData?.formats || [];
      const hasUrls = [...adaptive, ...combined].some((f) => !!f.url);

      if (hasUrls && (status === "OK" || status === "CONTENT_CHECK_REQUIRED")) {
        streamData = res;
        console.log(`[innertube] stream client success: ${ctx.client.clientName}`);
        break;
      }

      lastErr = new Error(
        res.playabilityStatus?.reason || `${ctx.client.clientName}: ${status}`
      );
      console.warn(`[innertube] ${ctx.client.clientName} failed: ${lastErr.message}`);
    } catch (e) {
      lastErr = e;
      console.warn(`[innertube] ${ctx.client.clientName} threw:`, e.message);
    }
  }

  if (!streamData) {
    throw lastErr || new Error("All stream clients failed — video may be unavailable");
  }

  const adaptive = streamData.streamingData?.adaptiveFormats || [];
  const combined = streamData.streamingData?.formats || [];
  const d = streamData.videoDetails || {};
  const dur = parseInt(d.lengthSeconds || "0") || 0;

  const safeName = (d.title || `media_${videoId}`)
    .replace(/[^\w\s\-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 100);

  if (format === "mp3") {
    const af = pickAudio(adaptive);
    if (!af?.url) throw new Error("No audio stream URL found");
    const e = mimeExt(af.mimeType);
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
      videoExt: e,
      audioExt: e,
      durationSeconds: dur,
    };
  }

  const maxH = HEIGHT_MAP[quality] || 1080;
  const vf = pickVideo(adaptive, maxH);
  const af = pickAudio(adaptive);

  if (vf?.url && af?.url) {
    console.log(`[innertube] video ${vf.height}p | audio ${af.mimeType}`);
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
      videoExt: mimeExt(vf.mimeType),
      audioExt: mimeExt(af.mimeType),
      durationSeconds: dur,
    };
  }

  // Combined stream fallback
  const cf = combined
    .filter((f) => f.url && (f.height || 0) <= maxH)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0];

  if (cf?.url) {
    const e = mimeExt(cf.mimeType);
    return {
      videoId,
      title: d.title || "Unknown",
      filename: safeName,
      format,
      quality,
      streamType: "single",
      url: cf.url,
      videoUrl: null,
      audioUrl: null,
      videoExt: e,
      audioExt: e,
      durationSeconds: dur,
    };
  }

  throw new Error("No stream URLs found — video may be age-restricted or unavailable");
}

// ── Playlist ──────────────────────────────────────────────────────────────────
// Uses Innertube /browse — this is public data (same as loading youtube.com/playlist)
// and is NOT bot-checked from datacenter IPs.

const UNAVAILABLE = new Set(["[private video]", "[deleted video]", "[unavailable]"]);

function parseVideos(data) {
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

function getContinuationToken(data) {
  const items = findAll(data, "continuationItemRenderer");
  for (const item of items) {
    const token =
      item?.continuationEndpoint?.continuationCommand?.token ||
      item?.button?.buttonRenderer?.command?.continuationCommand?.token;
    if (typeof token === "string" && token.length > 40) return token;
  }
  return null;
}

function getPlaylistMeta(data) {
  const headers = findAll(data, "playlistHeaderRenderer");
  if (headers.length) {
    const h = headers[0];
    return {
      title: txt(h.title) || "Unknown Playlist",
      author: txt(h.ownerText) || txt(h.subtitle) || "Unknown",
    };
  }
  const sidebar = findAll(data, "playlistSidebarPrimaryInfoRenderer");
  if (sidebar.length) {
    return { title: txt(sidebar[0].title) || "Unknown Playlist", author: "Unknown" };
  }
  return { title: "Unknown Playlist", author: "Unknown" };
}

export async function getPlaylistInfo(playlistId) {
  let data = await innertubePost("browse", {
    context: WEB_CTX,
    browseId: `VL${playlistId}`,
  });

  const meta = getPlaylistMeta(data);
  let all = parseVideos(data);

  const usedTokens = new Set();
  let pages = 0;

  while (pages < 25) {
    const token = getContinuationToken(data);
    if (!token || usedTokens.has(token)) break;
    usedTokens.add(token);

    try {
      data = await innertubePost("browse", {
        context: WEB_CTX,
        continuation: token,
      });
    } catch (e) {
      console.warn("[playlist continuation failed]", e.message);
      break;
    }

    const more = parseVideos(data);
    if (!more.length) break;
    all = all.concat(more);
    pages++;
  }

  // Deduplicate
  const seen = new Set();
  const videos = [];
  let idx = 1;
  for (const v of all) {
    if (seen.has(v.videoId)) continue;
    seen.add(v.videoId);
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