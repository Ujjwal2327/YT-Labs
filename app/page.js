"use client";

import { useState, useCallback } from "react";
import {
  Music,
  Video,
  Download,
  CheckSquare,
  Square,
  Clock,
  List,
  ChevronDown,
  Search,
  Loader2,
  AlertCircle,
  Play,
  BarChart2,
  X,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Quality Options ─────────────────────────────────────────────────────────

const MP4_QUALITIES = [
  { label: "Best Available", value: "highest" },
  { label: "1080p", value: "1080p" },
  { label: "720p", value: "720p" },
  { label: "480p", value: "480p" },
  { label: "360p", value: "360p" },
  { label: "Lowest", value: "lowest" },
];

const MP3_QUALITIES = [
  { label: "Small file (360p video)", value: "low" },
  { label: "Medium file (480p video)", value: "medium" },
  { label: "Large file (720p video)", value: "highest" },
];

// ─── Small Components ─────────────────────────────────────────────────────────

function Badge({ children, className }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono tracking-wide",
        className
      )}
    >
      {children}
    </span>
  );
}

function StatusDot({ status }) {
  return (
    <span
      className={cn("inline-block w-1.5 h-1.5 rounded-full", {
        "bg-zinc-600": status === "idle",
        "bg-blue-400 animate-pulse": status === "downloading",
        "bg-green-400": status === "done",
        "bg-red-400": status === "error",
      })}
    />
  );
}

function Select({ options, value, onChange, className }) {
  return (
    <div className={cn("relative", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-zinc-900 border border-zinc-800 rounded px-3 py-2 pr-8 text-sm font-mono text-zinc-200 focus:outline-none focus:border-zinc-600 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
    </div>
  );
}

function ProgressBar({ value, className }) {
  return (
    <div className={cn("h-[2px] bg-zinc-800 rounded-full overflow-hidden", className)}>
      <div
        className="h-full bg-[hsl(var(--accent))] transition-all duration-300 ease-out"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function VideoRow({ video, selected, onToggle, download }) {
  const status = download?.status || "idle";

  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-3 border-b border-zinc-900 transition-colors cursor-pointer",
        selected ? "bg-zinc-900/60" : "hover:bg-zinc-900/30"
      )}
      onClick={onToggle}
    >
      <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
        {selected ? (
          <div className="w-4 h-4 rounded border border-[hsl(var(--accent))] bg-[hsl(var(--accent))] flex items-center justify-center">
            <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-black">
              <path
                d="M1 4l3 3 5-6"
                stroke="black"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        ) : (
          <div className="w-4 h-4 rounded border border-zinc-700 group-hover:border-zinc-500 transition-colors" />
        )}
      </div>

      <span className="flex-shrink-0 w-6 text-xs font-mono text-zinc-600 text-right">
        {video.index}
      </span>

      <div className="flex-shrink-0 w-12 h-8 rounded overflow-hidden bg-zinc-900 relative">
        <img
          src={video.thumbnail}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => {
            e.target.src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32"><rect fill="%23111" width="48" height="32"/></svg>`;
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
          <Play className="w-3 h-3 text-white fill-white" />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-200 truncate leading-tight">{video.title}</p>
        <p className="text-xs text-zinc-600 mt-0.5 truncate">{video.author}</p>
        {download && status !== "idle" && (
          <div className="mt-1.5">
            {status === "downloading" && <ProgressBar value={download.progress} />}
            {status === "error" && (
              <p className="text-xs text-red-400 font-mono truncate">{download.error}</p>
            )}
          </div>
        )}
      </div>

      <span className="flex-shrink-0 text-xs font-mono text-zinc-500">
        {video.duration}
      </span>

      <div
        className="flex-shrink-0 flex items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <StatusDot status={status} />
        {status === "done" && (
          <span className="text-xs font-mono text-green-400">Done</span>
        )}
        {status === "error" && (
          <span className="text-xs font-mono text-red-400">Error</span>
        )}
        {status === "downloading" && (
          <span className="text-xs font-mono text-zinc-500">{download?.progress}%</span>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-zinc-500">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-xs font-mono tracking-widest uppercase">{label}</span>
      </div>
      <span className="text-xl font-mono text-zinc-100 tracking-tight">{value}</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playlist, setPlaylist] = useState(null);

  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("highest");

  const [selected, setSelected] = useState(new Set());
  const [downloads, setDownloads] = useState(new Map());
  const [bulkDownloading, setBulkDownloading] = useState(false);

  const [filter, setFilter] = useState("");

  const fetchPlaylist = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setPlaylist(null);
    setSelected(new Set());
    setDownloads(new Map());

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

  const toggleVideo = (videoId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  };

  const toggleAll = () => {
    if (!playlist) return;
    if (selected.size === playlist.videos.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(playlist.videos.map((v) => v.videoId)));
    }
  };

  const downloadVideo = async (videoId, title) => {
    setDownloads((prev) => {
      const next = new Map(prev);
      next.set(videoId, { videoId, status: "downloading", progress: 5 });
      return next;
    });

    try {
      // Server proxies the stream — no CORS, no decipher issues
      const response = await fetch(
        `/api/download?videoId=${videoId}&format=${format}&quality=${quality}`
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Download failed" }));
        throw new Error(err.error || "Download failed");
      }

      const contentLength = response.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength) : 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No readable stream");

      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        const progress = total
          ? Math.min(Math.round((received / total) * 95) + 5, 95)
          : Math.min(received / 500000 + 5, 90); // fallback if no content-length
        setDownloads((prev) => {
          const next = new Map(prev);
          const curr = next.get(videoId);
          if (curr) next.set(videoId, { ...curr, progress });
          return next;
        });
      }

      const mimeType = format === "mp3" ? "audio/webm" : "video/mp4";
      const ext = format === "mp3" ? "webm" : "mp4";
      const blob = new Blob(chunks, { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const safeName = title
        .replace(/[^\w\s\-]/g, "")
        .trim()
        .replace(/\s+/g, "_");
      a.download = `${safeName}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);

      setDownloads((prev) => {
        const next = new Map(prev);
        next.set(videoId, { videoId, status: "done", progress: 100 });
        return next;
      });
    } catch (err) {
      setDownloads((prev) => {
        const next = new Map(prev);
        next.set(videoId, {
          videoId,
          status: "error",
          progress: 0,
          error: err.message,
        });
        return next;
      });
    }
  };

  const downloadSelected = async () => {
    if (!playlist || selected.size === 0) return;
    setBulkDownloading(true);
    const toDownload = playlist.videos.filter((v) => selected.has(v.videoId));
    for (const video of toDownload) {
      const curr = downloads.get(video.videoId);
      if (curr?.status === "done") continue;
      await downloadVideo(video.videoId, video.title);
      await new Promise((r) => setTimeout(r, 800));
    }
    setBulkDownloading(false);
  };

  const filteredVideos =
    playlist?.videos.filter(
      (v) =>
        !filter ||
        v.title.toLowerCase().includes(filter.toLowerCase()) ||
        v.author.toLowerCase().includes(filter.toLowerCase())
    ) || [];

  const doneCount = [...downloads.values()].filter((d) => d.status === "done").length;
  const errorCount = [...downloads.values()].filter((d) => d.status === "error").length;
  const activeCount = [...downloads.values()].filter(
    (d) => d.status === "downloading" || d.status === "fetching"
  ).length;

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-900 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-[hsl(var(--accent))] flex items-center justify-center">
            <Download className="w-3.5 h-3.5 text-black" />
          </div>
          <span className="font-sans font-700 tracking-tight text-zinc-100 text-lg">
            playlist<span className="text-[hsl(var(--accent))]">dl</span>
          </span>
        </div>
        <span className="text-xs font-mono text-zinc-600">
          No API key required · Client-side downloads
        </span>
      </header>

      <div className="flex-1 max-w-4xl w-full mx-auto px-4 py-10 flex flex-col gap-8">
        {/* URL Input */}
        <div className="fade-in">
          <p className="text-xs font-mono text-zinc-500 tracking-widest uppercase mb-3">
            YouTube Playlist URL
          </p>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchPlaylist()}
                placeholder="https://youtube.com/playlist?list=..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 pr-10 text-sm font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-zinc-600 transition-colors"
              />
              {url && (
                <button
                  onClick={() => {
                    setUrl("");
                    setPlaylist(null);
                    setError(null);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              onClick={fetchPlaylist}
              disabled={loading || !url.trim()}
              className="flex items-center gap-2 px-5 py-3 bg-[hsl(var(--accent))] hover:bg-[hsl(142,71%,40%)] disabled:opacity-40 disabled:cursor-not-allowed text-black font-sans font-600 text-sm rounded-lg transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              {loading ? "Loading..." : "Fetch"}
            </button>
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 text-red-400 text-sm font-mono">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Playlist Content */}
        {playlist && (
          <div className="fade-in flex flex-col gap-6">
            {/* Info & Stats */}
            <div className="fade-in-delay-1">
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <h1 className="text-2xl font-sans font-700 text-zinc-100 leading-tight mb-1">
                    {playlist.title}
                  </h1>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-500 font-mono">
                      {playlist.author}
                    </span>
                    <a
                      href={`https://youtube.com/playlist?list=${playlist.playlistId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <StatCard icon={List} label="Videos" value={`${playlist.videoCount}`} />
                <StatCard icon={Clock} label="Total Length" value={playlist.totalDuration} />
                <StatCard icon={BarChart2} label="Avg. Length" value={playlist.averageDuration} />
              </div>
            </div>

            {/* Format & Quality */}
            <div className="fade-in-delay-2 bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-mono text-zinc-500 tracking-widest uppercase">
                  Format
                </label>
                <div className="flex gap-2">
                  {["mp4", "mp3"].map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setFormat(f);
                        setQuality("highest");
                      }}
                      className={cn(
                        "flex items-center gap-1.5 px-4 py-2 rounded border text-sm font-mono transition-all",
                        format === f
                          ? "border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]"
                          : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300"
                      )}
                    >
                      {f === "mp4" ? (
                        <Video className="w-3.5 h-3.5" />
                      ) : (
                        <Music className="w-3.5 h-3.5" />
                      )}
                      .{f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5 min-w-[180px]">
                <label className="text-xs font-mono text-zinc-500 tracking-widest uppercase">
                  Quality
                </label>
                <Select
                  options={format === "mp4" ? MP4_QUALITIES : MP3_QUALITIES}
                  value={quality}
                  onChange={setQuality}
                />
              </div>

              <div className="ml-auto flex items-center gap-2">
                {(doneCount > 0 || errorCount > 0) && (
                  <div className="flex items-center gap-2 text-xs font-mono text-zinc-500">
                    {doneCount > 0 && (
                      <span className="text-green-400">{doneCount} done</span>
                    )}
                    {errorCount > 0 && (
                      <span className="text-red-400">{errorCount} error</span>
                    )}
                  </div>
                )}
                <button
                  onClick={downloadSelected}
                  disabled={bulkDownloading || selected.size === 0 || activeCount > 0}
                  className="flex items-center gap-2 px-5 py-2 bg-[hsl(var(--accent))] hover:bg-[hsl(142,71%,40%)] disabled:opacity-40 disabled:cursor-not-allowed text-black text-sm font-sans font-600 rounded transition-colors"
                >
                  {bulkDownloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  Download {selected.size > 0 ? `(${selected.size})` : ""}
                </button>
              </div>
            </div>

            {/* Video List */}
            <div className="fade-in-delay-3">
              <div className="flex items-center gap-3 mb-2 px-1">
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-2 text-xs font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {selected.size === playlist.videos.length ? (
                    <CheckSquare className="w-3.5 h-3.5 text-[hsl(var(--accent))]" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                  {selected.size === playlist.videos.length
                    ? "Deselect all"
                    : "Select all"}
                </button>
                <span className="text-zinc-800">|</span>
                <span className="text-xs font-mono text-zinc-600">
                  {selected.size} of {playlist.videos.length} selected
                </span>
                <div className="ml-auto relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600" />
                  <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter..."
                    className="pl-7 pr-3 py-1.5 text-xs font-mono bg-zinc-900 border border-zinc-800 rounded text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-zinc-700 w-40"
                  />
                </div>
              </div>

              <div className="border border-zinc-900 rounded-lg overflow-hidden">
                {filteredVideos.length === 0 ? (
                  <div className="py-12 text-center text-zinc-600 font-mono text-sm">
                    No videos match your filter
                  </div>
                ) : (
                  filteredVideos.map((video) => (
                    <VideoRow
                      key={video.videoId}
                      video={video}
                      selected={selected.has(video.videoId)}
                      onToggle={() => toggleVideo(video.videoId)}
                      download={downloads.get(video.videoId)}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!playlist && !loading && !error && (
          <div className="flex-1 flex flex-col items-center justify-center py-24 gap-4 fade-in">
            <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <Download className="w-6 h-6 text-zinc-600" />
            </div>
            <div className="text-center">
              <p className="text-zinc-400 text-sm mb-1">
                Paste a YouTube playlist URL above
              </p>
              <p className="text-zinc-600 text-xs font-mono">
                Downloads happen directly in your browser — no signup required
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              <Badge className="bg-zinc-900 border border-zinc-800 text-zinc-500">
                <Video className="w-3 h-3" /> MP4
              </Badge>
              <Badge className="bg-zinc-900 border border-zinc-800 text-zinc-500">
                <Music className="w-3 h-3" /> MP3
              </Badge>
              <Badge className="bg-zinc-900 border border-zinc-800 text-zinc-500">
                <BarChart2 className="w-3 h-3" /> Multi-quality
              </Badge>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-900 px-6 py-4 text-center">
        <p className="text-xs font-mono text-zinc-700">
          Uses <code className="text-zinc-600">ytdl-core</code> · No API key ·
          Files download via your browser
        </p>
      </footer>
    </main>
  );
}