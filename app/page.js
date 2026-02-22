// 📁 app/page.jsx
"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Download, Search, Loader2, AlertCircle, Moon, Sun,
  ExternalLink, Clock, List, BarChart2, Music, Video,
  CheckCircle2, AlertTriangle, RefreshCw, ArrowUpDown, X,
  FlaskConical, Eye, Calendar, User, Tag,
} from "lucide-react";

// ── Theme ─────────────────────────────────────────────────────────────────────
function useTheme() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const sys = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(stored ? stored === "dark" : sys);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  return [dark, setDark];
}

// ── Constants ─────────────────────────────────────────────────────────────────
const MP4_QUALITIES = [
  { label: "Best Available", value: "highest" },
  { label: "1080p",          value: "1080p"   },
  { label: "720p",           value: "720p"    },
  { label: "480p",           value: "480p"    },
  { label: "360p",           value: "360p"    },
  { label: "Lowest",         value: "lowest"  },
];
const MP3_QUALITIES = [
  { label: "320 kbps (Best)",   value: "highest" },
  { label: "192 kbps (Medium)", value: "medium"  },
  { label: "128 kbps (Low)",    value: "low"     },
];
const SORT_OPTIONS = [
  { label: "Playlist order",    value: "default"   },
  { label: "Selected first",    value: "selected"  },
  { label: "Most viewed",       value: "views"     },
  { label: "Shortest first",    value: "shortest"  },
  { label: "Longest first",     value: "longest"   },
];

// ── URL Type Detection ────────────────────────────────────────────────────────
function detectUrlType(rawUrl) {
  if (!rawUrl?.trim()) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.replace(/^www\./, "");
    const hasList  = parsed.searchParams.has("list");
    const hasVideo = parsed.searchParams.has("v");

    if (host === "youtu.be") return "video";
    if (!["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) return null;

    if (parsed.pathname.startsWith("/shorts/")) return "video";
    if (hasList) return "playlist";
    if (hasVideo) return "video";
    return null;
  } catch {
    return null;
  }
}

function extractVideoId(rawUrl) {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1).split("?")[0];
    if (parsed.pathname.startsWith("/shorts/")) return parsed.pathname.split("/")[2];
    return parsed.searchParams.get("v") || null;
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sortVideos(videos, sortBy, selected) {
  if (!videos) return [];
  const arr = [...videos];
  switch (sortBy) {
    case "selected":
      return arr.sort((a, b) => {
        const aS = selected.has(a.videoId) ? 0 : 1;
        const bS = selected.has(b.videoId) ? 0 : 1;
        return aS - bS || a.index - b.index;
      });
    case "views":    return arr.sort((a, b) => b.viewCount - a.viewCount);
    case "shortest": return arr.sort((a, b) => a.durationSeconds - b.durationSeconds);
    case "longest":  return arr.sort((a, b) => b.durationSeconds - a.durationSeconds);
    default:         return arr;
  }
}

function formatViews(n) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K views`;
  return `${n} views`;
}

// ── Single-Video Download Card ─────────────────────────────────────────────────
function VideoCard({ video, onDownload, download }) {
  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("highest");
  // Track what format/quality the last completed download used
  const [downloadedWith, setDownloadedWith] = useState(null);

  const status   = download?.status   || "idle";
  const phase    = download?.phase    || "idle";
  const progress = download?.progress || 0;

  // Record what was used when a download completes
  useEffect(() => {
    if (status === "done") {
      setDownloadedWith({ format, quality });
    }
  }, [status]);

  // If the user changes format/quality after a completed download, treat as fresh
  const selectionChanged =
    downloadedWith &&
    (downloadedWith.format !== format || downloadedWith.quality !== quality);
  const effectiveStatus = selectionChanged ? "idle" : status;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Thumbnail row */}
      <div className="relative w-full aspect-video bg-muted overflow-hidden">
        <img
          src={video.thumbnail}
          alt={video.title}
          className="w-full h-full object-cover"
          onError={(e) => { e.target.style.display = "none"; }}
        />
        <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs font-mono px-1.5 py-0.5 rounded">
          {video.duration}
        </span>
      </div>

      {/* Info */}
      <div className="p-4 sm:p-5 flex flex-col gap-4">
        {/* Title + link */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-semibold leading-snug">{video.title}</h2>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={`https://youtube.com/watch?v=${video.videoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </TooltipTrigger>
            <TooltipContent>Watch on YouTube</TooltipContent>
          </Tooltip>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-45">{video.author}</span>
          </span>
          {video.viewCountDisplay && (
            <span className="flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 shrink-0" />
              {video.viewCountDisplay} views
            </span>
          )}
          {video.uploadDateDisplay && (
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              {video.uploadDateDisplay}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {video.duration}
          </span>
        </div>

        {/* Tags */}
        {video.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {video.tags.slice(0, 6).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
              >
                <Tag className="w-3 h-3" />
                {tag}
              </span>
            ))}
          </div>
        )}

        <Separator />

        {/* Download controls */}
        <div className="flex flex-wrap items-end gap-3 sm:gap-4">
          {/* Format */}
          <div className="flex flex-col gap-1.5">
            <Label>Format</Label>
            <Tabs
              value={format}
              onValueChange={(v) => { setFormat(v); setQuality("highest"); }}
            >
              <TabsList>
                <TabsTrigger value="mp4" className="flex items-center gap-1.5">
                  <Video className="w-3.5 h-3.5" />
                  <span>MP4</span>
                </TabsTrigger>
                <TabsTrigger value="mp3" className="flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5" />
                  <span>MP3</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Quality */}
          <div className="flex flex-col gap-1.5 w-40 sm:w-45">
            <Label>Quality</Label>
            <Select value={quality} onValueChange={setQuality}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(format === "mp4" ? MP4_QUALITIES : MP3_QUALITIES).map((q) => (
                    <SelectItem key={q.value} value={q.value}>
                      {q.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Download button */}
          <div className="ml-auto">
            <Button
              onClick={() => onDownload(video.videoId, video.title, format, quality, video.durationSeconds)}
              disabled={effectiveStatus === "downloading"}
              size="default"
              className="gap-2"
            >
              {effectiveStatus === "downloading" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : effectiveStatus === "done" ? (
                <RefreshCw className="w-4 h-4" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {effectiveStatus === "downloading"
                ? `${phase === "processing" ? "Converting" : "Downloading"} ${progress}%`
                : effectiveStatus === "done"
                  ? "Download again"
                  : "Download"}
            </Button>
          </div>
        </div>

        {/* Progress / status */}
        {effectiveStatus === "downloading" && (
          <Progress value={progress} className="h-1.5" />
        )}
        {effectiveStatus === "done" && (
          <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Download complete
          </p>
        )}
        {effectiveStatus === "error" && (
          <p className="text-sm text-destructive flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> {download.error || "Download failed"}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [dark, setDark] = useTheme();

  const [url, setUrl] = useState("");
  const [urlType, setUrlType] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Playlist state
  const [playlist, setPlaylist] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [downloads, setDownloads] = useState(new Map());
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("highest");
  const [sortBy, setSortBy] = useState("default");
  const [filter, setFilter] = useState("");

  // Single-video state
  const [videoInfo, setVideoInfo] = useState(null);
  const [videoDownload, setVideoDownload] = useState(null);

  // ── URL change handler ──────────────────────────────────────────────────────
  const handleUrlChange = (val) => {
    setUrl(val);
    const type = detectUrlType(val);
    setUrlType(type);
    if (!val.trim()) {
      setPlaylist(null);
      setVideoInfo(null);
      setError(null);
      setVideoDownload(null);
    }
  };

  const handleClear = () => {
    setUrl("");
    setUrlType(null);
    setPlaylist(null);
    setVideoInfo(null);
    setError(null);
    setDownloads(new Map());
    setVideoDownload(null);
    setSelected(new Set());
  };

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!url.trim()) return;
    const type = detectUrlType(url.trim());
    if (!type) {
      setError("Please enter a valid YouTube video or playlist URL.");
      return;
    }

    setLoading(true);
    setError(null);
    setPlaylist(null);
    setVideoInfo(null);
    setVideoDownload(null);
    setSelected(new Set());
    setDownloads(new Map());
    setSortBy("default");
    setFilter("");

    if (type === "playlist") {
      try {
        const res = await fetch(`/api/playlist?url=${encodeURIComponent(url.trim())}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch playlist");
        setPlaylist(data);
        setSelected(new Set(data.videos.map((v) => v.videoId)));
      } catch (err) {
        setError(err.message);
      }
    } else {
      try {
        const res = await fetch(`/api/video?url=${encodeURIComponent(url.trim())}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch video");
        setVideoInfo(data);
      } catch (err) {
        setError(err.message);
      }
    }

    setLoading(false);
  }, [url]);

  // ── Download helpers ────────────────────────────────────────────────────────
  const downloadVideo = async (videoId, title, fmt, qual, durationSeconds = 300) => {
    const updateDl = (patch) => {
      if (playlist) {
        setDownloads((prev) => {
          const next = new Map(prev);
          const curr = next.get(videoId) || {};
          next.set(videoId, { ...curr, ...patch });
          return next;
        });
      } else {
        setVideoDownload((prev) => ({ ...(prev || {}), ...patch }));
      }
    };

    updateDl({ status: "downloading", phase: "processing", progress: 0 });

    const formatSlowdown = fmt === "mp3" ? 2.5 : 1;
    const k = Math.min(0.07, Math.max(0.0004, (0.014 * (300 / durationSeconds)) / formatSlowdown));

    let fakeProgress = 0;
    const fakeInterval = setInterval(() => {
      const remaining = 85 - fakeProgress;
      const step = Math.max(0.1, remaining * k);
      fakeProgress = Math.min(85, fakeProgress + step);

      if (playlist) {
        setDownloads((prev) => {
          const next = new Map(prev);
          const curr = next.get(videoId);
          if (curr?.phase === "processing") {
            next.set(videoId, { ...curr, progress: Math.round(fakeProgress) });
          }
          return next;
        });
      } else {
        setVideoDownload((prev) => {
          if (prev?.phase === "processing") {
            return { ...prev, progress: Math.round(fakeProgress) };
          }
          return prev;
        });
      }
    }, 800);

    try {
      const res = await fetch(
        `/api/download?videoId=${videoId}&format=${fmt}&quality=${qual}`
      );

      clearInterval(fakeInterval);

      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "Download failed" }));
        throw new Error(e.error || "Download failed");
      }

      const contentLength = res.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength) : 0;
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No readable stream");

      const chunks = [];
      let received = 0;
      const startProgress = Math.round(fakeProgress);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;

        const streamProgress = total
          ? Math.min(Math.round((received / total) * (99 - startProgress) + startProgress), 99)
          : Math.min(startProgress + Math.round(received / 80000), 99);

        updateDl({ phase: "streaming", progress: streamProgress });
      }

      const mimeType = fmt === "mp3" ? "audio/mpeg" : "video/mp4";
      const ext = fmt === "mp3" ? "mp3" : "mp4";
      const blob = new Blob(chunks, { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${title.replace(/[^\w\s\-]/g, "").trim().replace(/\s+/g, "_")}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);

      updateDl({ status: "done", phase: "done", progress: 100 });
    } catch (err) {
      clearInterval(fakeInterval);
      updateDl({ status: "error", phase: "error", progress: 0, error: err.message });
    }
  };

  // ── Playlist selection helpers ──────────────────────────────────────────────
  const isDownloadingActive = bulkDownloading || [...downloads.values()].some((d) => d.status === "downloading");

  const toggleVideo = (id) => {
    if (isDownloadingActive) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!playlist || isDownloadingActive) return;
    setSelected(
      selected.size === playlist.videos.length
        ? new Set()
        : new Set(playlist.videos.map((v) => v.videoId))
    );
  };

  // ── Bulk download ───────────────────────────────────────────────────────────
  const downloadSelected = async () => {
    if (!playlist || selected.size === 0 || bulkDownloading) return;
    setBulkDownloading(true);
    setDownloads((prev) => {
      const next = new Map(prev);
      for (const id of selected) next.set(id, { status: "idle", phase: "idle", progress: 0 });
      return next;
    });
    for (const video of playlist.videos.filter((v) => selected.has(v.videoId))) {
      await downloadVideo(video.videoId, video.title, format, quality, video.durationSeconds);
      await new Promise((r) => setTimeout(r, 600));
    }
    setBulkDownloading(false);
    setDownloads(new Map());
  };

  // ── Derived state ───────────────────────────────────────────────────────────
  const allDl = [...downloads.values()];
  const doneCount   = allDl.filter((d) => d.status === "done").length;
  const errorCount  = allDl.filter((d) => d.status === "error").length;
  const activeCount = allDl.filter((d) => d.status === "downloading").length;
  const allSelected = playlist && selected.size === playlist.videos.length;

  const displayedVideos = useMemo(() => {
    if (!playlist) return [];
    const sorted = sortVideos(playlist.videos, sortBy, selected);
    if (!filter) return sorted;
    const q = filter.toLowerCase();
    return sorted.filter((v) =>
      v.title.toLowerCase().includes(q) || v.author.toLowerCase().includes(q)
    );
  }, [playlist, sortBy, filter, selected]);

  const typePill = urlType === "playlist"
    ? { label: "Playlist", icon: List }
    : urlType === "video"
      ? { label: "Video", icon: Video }
      : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">

      {/* ── Header ── */}
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-primary" />
            <span className="font-semibold text-lg">YT Labs</span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => setDark(!dark)}>
                {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{dark ? "Light mode" : "Dark mode"}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 sm:py-8 flex flex-col gap-5 sm:gap-6">

        {/* ── URL Input ── */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="yt-url">YouTube URL</Label>
            {typePill && (() => {
              const Icon = typePill.icon;
              return (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground border rounded-full px-2 py-0.5">
                  <Icon className="w-3 h-3" />
                  {typePill.label} detected
                </span>
              );
            })()}
          </div>

          <div className="flex rounded-md border border-input ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 overflow-hidden">
            <div className="flex items-center px-3 bg-muted border-r border-input shrink-0">
              <Search className="w-4 h-4 text-muted-foreground" />
            </div>
            <input
              id="yt-url"
              placeholder="https://youtube.com/watch?v=... or playlist?list=..."
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchData()}
              className="flex-1 min-w-0 px-3 py-2 text-sm font-mono bg-background text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {url && (
              <button
                onClick={handleClear}
                className="flex items-center px-2 text-muted-foreground hover:text-foreground border-l border-input bg-background transition-colors"
                tabIndex={-1}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <Button
              onClick={fetchData}
              disabled={loading || !url.trim() || !urlType}
              className="rounded-none rounded-r-md border-l border-input shrink-0"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Download className="w-4 h-4" />}
              <span className="hidden sm:inline ml-1">
                {loading ? "Loading..." : "Fetch"}
              </span>
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </p>
          )}
        </div>

        {/* ══════════════════════════════════════════════
            SINGLE VIDEO MODE
        ══════════════════════════════════════════════ */}
        {videoInfo && !playlist && (
          <VideoCard
            video={videoInfo}
            download={videoDownload}
            onDownload={(videoId, title, fmt, qual, dur) =>
              downloadVideo(videoId, title, fmt, qual, dur)
            }
          />
        )}

        {/* ══════════════════════════════════════════════
            PLAYLIST MODE
        ══════════════════════════════════════════════ */}
        {playlist && (
          <>
            <Separator />

            {/* Title + author */}
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-semibold leading-tight">{playlist.title}</h2>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={`https://youtube.com/playlist?list=${playlist.playlistId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>Open on YouTube</TooltipContent>
                </Tooltip>
              </div>
              <p className="text-sm text-muted-foreground">{playlist.author}</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                {
                  icon: List,
                  label: "Videos",
                  value: String(playlist.videoCount),
                  sub: playlist.unavailableCount > 0
                    ? `${playlist.unavailableCount} unavailable`
                    : null,
                },
                { icon: Clock,     label: "Total", value: playlist.totalDuration,   sub: null },
                { icon: BarChart2, label: "Avg",   value: playlist.averageDuration, sub: null },
              ].map(({ icon: Icon, label, value, sub }) => (
                <div key={label} className="rounded-lg border bg-card p-3 sm:p-4 flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-muted-foreground text-xs">
                    <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </div>
                  <p className="text-lg sm:text-2xl font-mono font-medium leading-tight">{value}</p>
                  <p className="text-xs text-muted-foreground sm:hidden">{label}</p>
                  {sub && <p className="text-xs text-destructive font-mono">{sub}</p>}
                </div>
              ))}
            </div>

            <Separator />

            {/* Format + Quality + Download */}
            <div className="flex flex-wrap items-end gap-3 sm:gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Format</Label>
                <Tabs value={format} onValueChange={(v) => { setFormat(v); setQuality("highest"); }}>
                  <TabsList>
                    <TabsTrigger value="mp4" className="flex items-center gap-1.5">
                      <Video className="w-3.5 h-3.5" /><span>MP4</span>
                    </TabsTrigger>
                    <TabsTrigger value="mp3" className="flex items-center gap-1.5">
                      <Music className="w-3.5 h-3.5" /><span>MP3</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="flex flex-col gap-1.5 w-40 sm:w-45">
                <Label>Quality</Label>
                <Select value={quality} onValueChange={setQuality}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(format === "mp4" ? MP4_QUALITIES : MP3_QUALITIES).map((q) => (
                        <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="ml-auto flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
                {(doneCount > 0 || errorCount > 0) && (
                  <div className="flex items-center gap-2 text-xs font-mono">
                    {doneCount > 0 && (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{doneCount} done</span>
                        <span className="sm:hidden">{doneCount}</span>
                      </span>
                    )}
                    {errorCount > 0 && (
                      <span className="flex items-center gap-1 text-destructive">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{errorCount} failed</span>
                        <span className="sm:hidden">{errorCount}</span>
                      </span>
                    )}
                  </div>
                )}
                <Button
                  onClick={downloadSelected}
                  disabled={selected.size === 0 || activeCount > 0}
                  size="sm"
                  className="sm:h-10 sm:px-4"
                >
                  {bulkDownloading
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : doneCount > 0 && doneCount === selected.size
                      ? <RefreshCw className="w-4 h-4" />
                      : <Download className="w-4 h-4" />}
                  <span className="hidden sm:inline">
                    {bulkDownloading ? "Downloading..." : `Download (${selected.size})`}
                  </span>
                  <span className="sm:hidden">{selected.size}</span>
                </Button>
              </div>
            </div>

            <Separator />

            {/* Toolbar */}
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all"
                  checked={!!allSelected}
                  onCheckedChange={toggleAll}
                  disabled={isDownloadingActive}
                />
                <Label
                  htmlFor="select-all"
                  className={`text-sm font-normal whitespace-nowrap ${isDownloadingActive ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </Label>
              </div>

              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {selected.size}/{playlist.videos.length}
              </span>

              <div className="flex items-center gap-1.5">
                <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="h-8 w-32.5 sm:w-38.75 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {SORT_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="ml-auto relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Filter..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="pl-8 h-8 w-28 sm:w-40 text-sm"
                />
              </div>
            </div>

            {/* Video list */}
            <div className="rounded-lg border divide-y overflow-hidden">
              {displayedVideos.length === 0 ? (
                <p className="text-center py-12 text-sm text-muted-foreground">
                  No videos match your filter.
                </p>
              ) : displayedVideos.map((video) => {
                const dl = downloads.get(video.videoId);
                const status = dl?.status || "idle";
                const phase  = dl?.phase  || "idle";
                const isSelected = selected.has(video.videoId);

                return (
                  <div
                    key={video.videoId}
                    onClick={() => toggleVideo(video.videoId)}
                    className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 transition-all select-none ${
                      isDownloadingActive ? "cursor-not-allowed" : "cursor-pointer"
                    } ${
                      isSelected
                        ? "bg-background hover:bg-muted/40"
                        : "opacity-40 grayscale hover:opacity-60"
                    }`}
                  >
                    <div onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleVideo(video.videoId)}
                      />
                    </div>

                    <span className="w-4 sm:w-5 text-xs text-muted-foreground text-right shrink-0 font-mono hidden sm:block">
                      {video.index}
                    </span>

                    <div className="shrink-0 w-12 h-8 sm:w-14 sm:h-9 rounded overflow-hidden bg-muted">
                      <img
                        src={video.thumbnail}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = "none"; }}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate leading-snug">{video.title}</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs text-muted-foreground truncate">{video.author}</p>
                        {video.viewCount > 0 && (
                          <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                            · {formatViews(video.viewCount)}
                          </span>
                        )}
                        {video.uploadDateDisplay && (
                          <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                            · {video.uploadDateDisplay}
                          </span>
                        )}
                      </div>
                      {status === "downloading" && (
                        <Progress value={dl.progress} className="h-1 mt-1.5" />
                      )}
                      {status === "error" && (
                        <p className="text-xs text-destructive mt-0.5 truncate font-mono">
                          {dl.error}
                        </p>
                      )}
                    </div>

                    <span className="shrink-0 text-xs text-muted-foreground font-mono hidden sm:block">
                      {video.duration}
                    </span>

                    <div className="shrink-0 w-5 flex justify-center" onClick={(e) => e.stopPropagation()}>
                      {status === "downloading" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {phase === "processing"
                              ? `Converting — ${dl.progress}%`
                              : `Downloading — ${dl.progress}%`}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {status === "done" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default">
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Done</TooltipContent>
                        </Tooltip>
                      )}
                      {status === "error" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default">
                              <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{dl.error || "Error"}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Empty state ── */}
        {!playlist && !videoInfo && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-20 sm:py-24 gap-4 text-center">
            <div className="rounded-full border p-4 bg-muted">
              <FlaskConical className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">Paste a YouTube URL to get started</p>
              <p className="text-sm text-muted-foreground mt-1">
                Works with individual videos and full playlists — no API key needed.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground">
                <Video className="w-3.5 h-3.5" /> Single video
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground">
                <List className="w-3.5 h-3.5" /> Full playlist
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground">
                <Music className="w-3.5 h-3.5" /> MP3 up to 320kbps
              </span>
            </div>
          </div>
        )}

      </main>

      <footer className="border-t py-4 text-center text-xs text-muted-foreground font-mono">
        YT Labs · Powered by yt-dlp &amp; ffmpeg
      </footer>
    </div>
  );
}