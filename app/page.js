// 📁 app/page.jsx
"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
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
  FlaskConical,
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
  { label: "Latest first",      value: "latest"    },
  { label: "Oldest first",      value: "oldest"    },
  { label: "Most viewed",       value: "views"     },
  { label: "Shortest first",    value: "shortest"  },
  { label: "Longest first",     value: "longest"   },
];

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
    case "latest":   return arr.sort((a, b) => b.uploadDate.localeCompare(a.uploadDate));
    case "oldest":   return arr.sort((a, b) => a.uploadDate.localeCompare(b.uploadDate));
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

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [dark, setDark] = useTheme();

  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playlist, setPlaylist] = useState(null);

  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("highest");
  const [sortBy, setSortBy] = useState("default");
  const [filter, setFilter] = useState("");

  const [selected, setSelected] = useState(new Set());
  const [downloads, setDownloads] = useState(new Map());
  const [bulkDownloading, setBulkDownloading] = useState(false);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchPlaylist = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setPlaylist(null);
    setSelected(new Set());
    setDownloads(new Map());
    setSortBy("default");
    setFilter("");
    try {
      const res = await fetch(`/api/playlist?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch playlist");
      setPlaylist(data);
      setSelected(new Set(data.videos.map((v) => v.videoId)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  // ── Selection ───────────────────────────────────────────────────────────────
  const toggleVideo = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (!playlist) return;
    setSelected(
      selected.size === playlist.videos.length
        ? new Set()
        : new Set(playlist.videos.map((v) => v.videoId))
    );
  };

  // ── Download single ─────────────────────────────────────────────────────────
  const downloadVideo = async (videoId, title) => {
    // Find the video's duration so we can scale progress speed
    const videoMeta = playlist?.videos.find((v) => v.videoId === videoId);
    const durationSeconds = videoMeta?.durationSeconds || 300;

    setDownloads((prev) =>
      new Map(prev).set(videoId, { status: "downloading", phase: "processing", progress: 0 })
    );

    // Fake progress during server-side processing (yt-dlp download + ffmpeg convert).
    // k scales with duration. MP3 also runs libmp3lame encoding, taking ~2.5x longer than
    // MP4, so we divide k by 2.5 for mp3 to keep the bar moving at a matching pace.
    const formatSlowdown = format === "mp3" ? 2.5 : 1;
    const k = Math.min(0.07, Math.max(0.0004, (0.014 * (300 / durationSeconds)) / formatSlowdown));

    let fakeProgress = 0;
    const fakeInterval = setInterval(() => {
      const remaining = 85 - fakeProgress;
      const step = Math.max(0.1, remaining * k);
      fakeProgress = Math.min(85, fakeProgress + step);
      setDownloads((prev) => {
        const next = new Map(prev);
        const curr = next.get(videoId);
        // Only update if still in processing phase
        if (curr?.phase === "processing") {
          next.set(videoId, { ...curr, progress: Math.round(fakeProgress) });
        }
        return next;
      });
    }, 800);

    try {
      const res = await fetch(
        `/api/download?videoId=${videoId}&format=${format}&quality=${quality}`
      );

      // Server responded — stop fake progress, keep current value as starting point
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

      // Get current fake progress as floor so bar never goes backwards
      const startProgress = Math.round(fakeProgress);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;

        // Map real bytes received onto the remaining range [startProgress → 99]
        const streamProgress = total
          ? Math.min(Math.round((received / total) * (99 - startProgress) + startProgress), 99)
          : Math.min(startProgress + Math.round(received / 80000), 99);

        setDownloads((prev) => {
          const next = new Map(prev);
          const curr = next.get(videoId);
          if (curr) next.set(videoId, { ...curr, phase: "streaming", progress: streamProgress });
          return next;
        });
      }

      // Trigger browser save
      const mimeType = format === "mp3" ? "audio/mpeg" : "video/mp4";
      const ext = format === "mp3" ? "mp3" : "mp4";
      const blob = new Blob(chunks, { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${title.replace(/[^\w\s\-]/g, "").trim().replace(/\s+/g, "_")}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);

      setDownloads((prev) =>
        new Map(prev).set(videoId, { status: "done", phase: "done", progress: 100 })
      );
    } catch (err) {
      clearInterval(fakeInterval);
      setDownloads((prev) =>
        new Map(prev).set(videoId, { status: "error", phase: "error", progress: 0, error: err.message })
      );
    }
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
      await downloadVideo(video.videoId, video.title);
      await new Promise((r) => setTimeout(r, 600));
    }
    setBulkDownloading(false);
  };

  // ── Derived state ───────────────────────────────────────────────────────────
  const allDl = [...downloads.values()];
  const doneCount  = allDl.filter((d) => d.status === "done").length;
  const errorCount = allDl.filter((d) => d.status === "error").length;
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

        {/* ── URL Input — shadcn input-group style ── */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="playlist-url">YouTube Playlist URL</Label>
          {/* Input group: icon prefix + input + button suffix all joined */}
          <div className="flex rounded-md border border-input ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 overflow-hidden">
            {/* Prefix icon */}
            <div className="flex items-center px-3 bg-muted border-r border-input shrink-0">
              <Search className="w-4 h-4 text-muted-foreground" />
            </div>
            {/* Input — no individual border/ring */}
            <input
              id="playlist-url"
              placeholder="https://youtube.com/playlist?list=PLxxxxxxx"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchPlaylist()}
              className="flex-1 min-w-0 px-3 py-2 text-sm font-mono bg-background text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {/* Clear button — only when there's input */}
            {url && (
              <button
                onClick={() => { setUrl(""); setPlaylist(null); setError(null); }}
                className="flex items-center px-2 text-muted-foreground hover:text-foreground border-l border-input bg-background transition-colors"
                tabIndex={-1}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Fetch button — joined suffix */}
            <Button
              onClick={fetchPlaylist}
              disabled={loading || !url.trim()}
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

        {/* ── Playlist ── */}
        {playlist && (
          <>
            <Separator />

            {/* Title + author */}
            <div className="flex flex-col gap-0.5">
              <div className="flex items-start gap-2 flex-wrap">
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
                { icon: Clock,     label: "Total", value: playlist.totalDuration, sub: null },
                { icon: BarChart2, label: "Avg",   value: playlist.averageDuration, sub: null },
              ].map(({ icon: Icon, label, value, sub }) => (
                <div key={label} className="rounded-lg border bg-card p-3 sm:p-4 flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-muted-foreground text-xs">
                    <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </div>
                  <p className="text-lg sm:text-2xl font-mono font-medium leading-tight">{value}</p>
                  <p className="text-xs text-muted-foreground sm:hidden">{label}</p>
                  {sub && (
                    <p className="text-xs text-destructive font-mono">{sub}</p>
                  )}
                </div>
              ))}
            </div>

            <Separator />

            {/* Format + Quality + Download */}
            <div className="flex flex-wrap items-end gap-3 sm:gap-4">
              {/* Format */}
              <div className="flex flex-col gap-1.5">
                <Label>Format</Label>
                <Tabs value={format} onValueChange={(v) => { setFormat(v); setQuality("highest"); }}>
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
              <div className="flex flex-col gap-1.5 w-[160px] sm:w-[180px]">
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

              {/* Status + Download */}
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
              {/* Select all */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all"
                  checked={!!allSelected}
                  onCheckedChange={toggleAll}
                />
                <Label htmlFor="select-all" className="cursor-pointer text-sm font-normal whitespace-nowrap">
                  {allSelected ? "Deselect all" : "Select all"}
                </Label>
              </div>

              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {selected.size}/{playlist.videos.length}
              </span>

              {/* Sort */}
              <div className="flex items-center gap-1.5">
                <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="h-8 w-[130px] sm:w-[155px] text-xs">
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

              {/* Filter */}
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

            {/* ── Video list ── */}
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
                    className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 cursor-pointer transition-all select-none ${
                      isSelected
                        ? "bg-background hover:bg-muted/40"
                        : "opacity-40 grayscale hover:opacity-60"
                    }`}
                  >
                    {/* Checkbox — stop propagation so double-toggle doesn't happen */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleVideo(video.videoId)}
                      />
                    </div>

                    {/* Index */}
                    <span className="w-4 sm:w-5 text-xs text-muted-foreground text-right shrink-0 font-mono hidden sm:block">
                      {video.index}
                    </span>

                    {/* Thumbnail */}
                    <div className="shrink-0 w-12 h-8 sm:w-14 sm:h-9 rounded overflow-hidden bg-muted">
                      <img
                        src={video.thumbnail}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = "none"; }}
                      />
                    </div>

                    {/* Info */}
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

                      {/* Single progress bar for both processing and streaming phases */}
                      {status === "downloading" && (
                        <Progress value={dl.progress} className="h-1 mt-1.5" />
                      )}
                      {status === "error" && (
                        <p className="text-xs text-destructive mt-0.5 truncate font-mono">
                          {dl.error}
                        </p>
                      )}
                    </div>

                    {/* Duration */}
                    <span className="shrink-0 text-xs text-muted-foreground font-mono hidden sm:block">
                      {video.duration}
                    </span>

                    {/* Status icon — only when not idle, icon only as tooltip trigger */}
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
        {!playlist && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-20 sm:py-24 gap-4 text-center">
            <div className="rounded-full border p-4 bg-muted">
              <FlaskConical className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">Paste a YouTube playlist URL to get started</p>
              <p className="text-sm text-muted-foreground mt-1">
                Download videos as MP4 or audio as MP3 — no API key needed.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground">
                <Video className="w-3.5 h-3.5" /> MP4 up to 1080p
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