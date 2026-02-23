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
  Download,
  Search,
  Loader2,
  AlertCircle,
  Moon,
  Sun,
  ExternalLink,
  Clock,
  List,
  BarChart2,
  Music,
  Video,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ArrowUpDown,
  X,
  FlaskConical,
  Eye,
  Calendar,
  User,
  Tag,
  Cpu,
  Server,
  Zap,
  Info,
  ImageIcon,
  Folder,
  FolderOpen,
  SkipForward,
  Replace,
  FilePlus,
  Settings2,
  ChevronRight,
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
  { label: "1080p", value: "1080p" },
  { label: "720p", value: "720p" },
  { label: "480p", value: "480p" },
  { label: "360p", value: "360p" },
  { label: "Lowest", value: "lowest" },
];
const MP3_QUALITIES = [
  { label: "320 kbps (Best)", value: "highest" },
  { label: "192 kbps (Medium)", value: "medium" },
  { label: "128 kbps (Low)", value: "low" },
];
const SORT_OPTIONS = [
  { label: "Playlist order", value: "default" },
  { label: "Selected first", value: "selected" },
  { label: "Most viewed", value: "views" },
  { label: "Shortest first", value: "shortest" },
  { label: "Longest first", value: "longest" },
];

// ── URL Type Detection ────────────────────────────────────────────────────────
const UNVIEWABLE_LIST_PREFIXES = ["RD", "RDMM", "RDem", "FL", "WL", "LL", "LM"];

function isUnviewablePlaylist(listId) {
  if (!listId) return false;
  return UNVIEWABLE_LIST_PREFIXES.some((p) => listId.startsWith(p));
}

function detectUrlType(rawUrl) {
  if (!rawUrl?.trim()) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.replace(/^www\./, "");
    const listId = parsed.searchParams.get("list");
    const hasVideo = parsed.searchParams.has("v");
    if (host === "youtu.be") return "video";
    if (!["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host))
      return null;
    if (parsed.pathname.startsWith("/shorts/")) return "video";
    if (listId && !isUnviewablePlaylist(listId)) return "playlist";
    if (hasVideo) return "video";
    return null;
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
      return arr.sort(
        (a, b) =>
          (selected.has(a.videoId) ? 0 : 1) -
            (selected.has(b.videoId) ? 0 : 1) || a.index - b.index,
      );
    case "views":
      return arr.sort((a, b) => b.viewCount - a.viewCount);
    case "shortest":
      return arr.sort((a, b) => a.durationSeconds - b.durationSeconds);
    case "longest":
      return arr.sort((a, b) => b.durationSeconds - a.durationSeconds);
    default:
      return arr;
  }
}

function formatViews(n) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K views`;
  return `${n} views`;
}

// ── File System Access API helpers ────────────────────────────────────────────
function isFSASupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Detects Brave by checking the brave object injected into navigator */
function isBrave() {
  return (
    typeof navigator !== "undefined" &&
    // @ts-ignore
    (navigator.brave != null || navigator.userAgent.includes("Brave"))
  );
}

/**
 * Attempts a no-op write to a temp file in the directory to verify
 * that createWritable() actually works (Brave blocks it silently sometimes).
 * Returns true if FSA writes are functional.
 */
async function testFSAWritable(dirHandle) {
  try {
    const testFile = await dirHandle.getFileHandle("__ytlabs_test__", {
      create: true,
    });
    const w = await testFile.createWritable();
    await w.write(new Uint8Array([0]));
    await w.close();
    // Clean up
    try {
      await dirHandle.removeEntry("__ytlabs_test__");
    } catch (_) {}
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds an available filename in the directory handle, applying conflict resolution.
 * Returns the filename to use, or null if the file should be skipped.
 */
async function resolveFilename(dirHandle, filename, conflictMode) {
  let exists = false;
  try {
    await dirHandle.getFileHandle(filename);
    exists = true;
  } catch (e) {
    if (e.name !== "NotFoundError") throw e;
  }

  if (!exists) return filename;

  if (conflictMode === "skip") return null;
  if (conflictMode === "replace") return filename;

  // rename: find next available name like "file (1).mp4", "file (2).mp4", etc.
  const lastDot = filename.lastIndexOf(".");
  const base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;
  const ext = lastDot !== -1 ? filename.slice(lastDot) : "";
  for (let i = 1; i <= 999; i++) {
    const candidate = `${base} (${i})${ext}`;
    try {
      await dirHandle.getFileHandle(candidate);
    } catch (e) {
      if (e.name === "NotFoundError") return candidate;
    }
  }
  return filename; // fallback
}

/**
 * Save a Blob to the chosen directory (FSA API) or fall back to browser download.
 * If FSA write fails at runtime (e.g. Brave shields), falls back to a regular download.
 */
async function saveBlob(blob, filename, dirHandle, conflictMode) {
  if (!dirHandle) {
    triggerBlobDownload(blob, filename);
    return { saved: true, skipped: false, fsaFailed: false };
  }

  let finalName;
  try {
    finalName = await resolveFilename(dirHandle, filename, conflictMode);
  } catch {
    // FSA read failed — fall back to browser download
    triggerBlobDownload(blob, filename);
    return { saved: true, skipped: false, fsaFailed: true };
  }

  if (finalName === null)
    return { saved: false, skipped: true, fsaFailed: false };

  try {
    const fh = await dirHandle.getFileHandle(finalName, { create: true });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();
    return { saved: true, skipped: false, fsaFailed: false };
  } catch {
    // createWritable() blocked (Brave shields, permissions, etc.) — fall back
    triggerBlobDownload(blob, filename);
    return { saved: true, skipped: false, fsaFailed: true };
  }
}

// ── ffmpeg.wasm loader ────────────────────────────────────────────────────────
let ffmpegInstance = null;
let ffmpegLoading = false;
let ffmpegReady = false;

async function getFFmpeg(onLog) {
  if (ffmpegReady && ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoading) {
    await new Promise((r) => {
      const check = setInterval(() => {
        if (ffmpegReady) {
          clearInterval(check);
          r();
        }
      }, 100);
    });
    return ffmpegInstance;
  }

  ffmpegLoading = true;
  onLog?.("Loading ffmpeg.wasm (first-time setup, ~20 MB)…");

  try {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");

    ffmpegInstance = new FFmpeg();

    const baseUrl = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await ffmpegInstance.load({
      coreURL: await toBlobURL(`${baseUrl}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(
        `${baseUrl}/ffmpeg-core.wasm`,
        "application/wasm",
      ),
    });

    ffmpegReady = true;
    ffmpegLoading = false;
    onLog?.("ffmpeg.wasm ready.");
    return ffmpegInstance;
  } catch (err) {
    ffmpegLoading = false;
    throw new Error(`Failed to load ffmpeg.wasm: ${err.message}`);
  }
}

// ── Device-mode download helpers ──────────────────────────────────────────────
async function fetchViaCorsProxy(
  cdnUrl,
  onProgress,
  progressStart = 0,
  progressEnd = 100,
) {
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(cdnUrl)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`Proxy error ${res.status}`);

  const total = parseInt(res.headers.get("content-length") || "0");
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) {
      const p = total
        ? progressStart +
          Math.round((received / total) * (progressEnd - progressStart))
        : Math.min(
            progressStart + Math.round(received / 50000),
            progressEnd - 5,
          );
      onProgress(p);
    }
  }

  const all = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all;
}

async function deviceModeMP3(
  streamInfo,
  quality,
  title,
  onProgress,
  onLog,
  dlSettings,
) {
  const bitrateMap = { highest: "320k", medium: "192k", low: "128k" };
  const bitrate = bitrateMap[quality] || "192k";
  const audioUrl = streamInfo.url;
  const audioExt = streamInfo.audioExt || "m4a";

  onLog?.("Fetching audio stream…");
  onProgress?.(5);

  const audioBytes = await fetchViaCorsProxy(audioUrl, onProgress, 5, 45);

  onLog?.("Starting browser-side conversion…");
  const ff = await getFFmpeg(onLog);
  onProgress?.(50);

  const inputName = `input.${audioExt}`;
  const outputName = "output.mp3";
  await ff.writeFile(inputName, audioBytes);
  onProgress?.(55);

  onLog?.(`Converting to MP3 (${bitrate}) on your device…`);
  await ff.exec([
    "-i",
    inputName,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    bitrate,
    "-y",
    outputName,
  ]);
  onProgress?.(90);

  const mp3Data = await ff.readFile(outputName);
  const blob = new Blob([mp3Data.buffer], { type: "audio/mpeg" });
  const safeName = title
    .replace(/[^\w\s\-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 100);
  const result = await saveBlob(
    blob,
    `${safeName}.mp3`,
    dlSettings?.dirHandle,
    dlSettings?.conflictMode,
  );

  try {
    await ff.deleteFile(inputName);
  } catch {}
  try {
    await ff.deleteFile(outputName);
  } catch {}

  onProgress?.(100);
  onLog?.(result.skipped ? "Skipped — file already exists." : "Done!");
  return result;
}

async function deviceModeMP4(streamInfo, title, onProgress, onLog, dlSettings) {
  const safeName = title
    .replace(/[^\w\s\-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 100);

  if (streamInfo.streamType === "dual") {
    onLog?.("Fetching video + audio streams in parallel…");

    let videoProgress = 0;
    let audioProgress = 0;
    const updateProgress = () => {
      const combined = videoProgress * 0.85 + audioProgress * 0.15;
      onProgress?.(5 + Math.round(combined * 0.65));
    };

    const [videoBytes, audioBytes] = await Promise.all([
      fetchViaCorsProxy(
        streamInfo.videoUrl,
        (p) => {
          videoProgress = p;
          updateProgress();
        },
        0,
        100,
      ),
      fetchViaCorsProxy(
        streamInfo.audioUrl,
        (p) => {
          audioProgress = p;
          updateProgress();
        },
        0,
        100,
      ),
    ]);

    onProgress?.(72);
    onLog?.("Muxing on your device…");
    const ff = await getFFmpeg(onLog);
    onProgress?.(76);

    const videoExt = streamInfo.videoExt || "mp4";
    const audioExt = streamInfo.audioExt || "m4a";
    const videoIn = `vin.${videoExt}`;
    const audioIn = `ain.${audioExt}`;

    await ff.writeFile(videoIn, videoBytes);
    await ff.writeFile(audioIn, audioBytes);
    await ff.exec([
      "-i",
      videoIn,
      "-i",
      audioIn,
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      "-y",
      "out.mp4",
    ]);
    onProgress?.(94);

    const mp4Data = await ff.readFile("out.mp4");
    const blob = new Blob([mp4Data.buffer], { type: "video/mp4" });
    const result = await saveBlob(
      blob,
      `${safeName}.mp4`,
      dlSettings?.dirHandle,
      dlSettings?.conflictMode,
    );

    try {
      await ff.deleteFile(videoIn);
    } catch {}
    try {
      await ff.deleteFile(audioIn);
    } catch {}
    try {
      await ff.deleteFile("out.mp4");
    } catch {}

    onProgress?.(100);
    onLog?.(result.skipped ? "Skipped — file already exists." : "Done!");
    return result;
  } else {
    onLog?.("Fetching video stream…");
    const bytes = await fetchViaCorsProxy(
      streamInfo.url,
      (p) => onProgress?.(5 + Math.round(p * 0.62)),
      0,
      100,
    );

    onProgress?.(68);
    onLog?.("Remuxing into MP4…");
    const ff = await getFFmpeg(onLog);
    onProgress?.(72);

    const ext = streamInfo.videoExt || "mp4";
    const inputName = `sin.${ext}`;

    await ff.writeFile(inputName, bytes);
    await ff.exec([
      "-i",
      inputName,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-y",
      "out.mp4",
    ]);
    onProgress?.(94);

    const mp4Data = await ff.readFile("out.mp4");
    const blob = new Blob([mp4Data.buffer], { type: "video/mp4" });
    const result = await saveBlob(
      blob,
      `${safeName}.mp4`,
      dlSettings?.dirHandle,
      dlSettings?.conflictMode,
    );

    try {
      await ff.deleteFile(inputName);
    } catch {}
    try {
      await ff.deleteFile("out.mp4");
    } catch {}

    onProgress?.(100);
    onLog?.(result.skipped ? "Skipped — file already exists." : "Done!");
    return result;
  }
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function downloadThumbnail(videoId, title, dlSettings) {
  const safeName = (title || videoId)
    .replace(/[^\w\s\-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 100);

  const candidates = [
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob.size < 5000) continue;
      const result = await saveBlob(
        blob,
        `${safeName}_thumbnail.jpg`,
        dlSettings?.dirHandle,
        dlSettings?.conflictMode,
      );
      return result;
    } catch (_) {}
  }
  throw new Error("Could not fetch thumbnail");
}

// ── Download Settings Modal ───────────────────────────────────────────────────
function DownloadSettingsModal({
  open,
  onConfirm,
  onCancel,
  initialSettings,
  downloadCount = 1,
}) {
  const fsaSupported = isFSASupported();
  const brave = typeof window !== "undefined" && isBrave();
  const [dirHandle, setDirHandle] = useState(
    initialSettings?.dirHandle || null,
  );
  const [conflictMode, setConflictMode] = useState(
    initialSettings?.conflictMode || "skip",
  );
  const [pickError, setPickError] = useState(null);
  // null = untested, true = writable, false = blocked
  const [fsaWritable, setFsaWritable] = useState(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (open) {
      setDirHandle(initialSettings?.dirHandle || null);
      setConflictMode(initialSettings?.conflictMode || "skip");
      setPickError(null);
      setFsaWritable(null);
      setPicking(false);
    }
  }, [open]);

  if (!open) return null;

  const pickDir = async () => {
    setPickError(null);
    setFsaWritable(null);
    setPicking(true);
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      // Test if createWritable actually works (Brave may silently block it)
      const writable = await testFSAWritable(handle);
      setFsaWritable(writable);
      setDirHandle(handle);
      if (!writable) {
        setPickError(
          brave
            ? "Brave Shields is blocking file writes. Disable Shields for this site (or use Chrome). Files will download normally instead."
            : "Your browser blocked file writes to this folder. Files will download to your Downloads folder instead.",
        );
      }
    } catch (e) {
      if (e.name === "AbortError") {
        setPicking(false);
        return; // user dismissed picker — no error
      }
      // SecurityError, NotAllowedError, etc. (common in Brave with shields)
      setPickError(
        brave
          ? "Brave Shields blocked folder access. Try disabling Shields for this site, or use Chrome for folder selection."
          : `Could not access folder: ${e.message || e.name}. Files will download normally.`,
      );
    }
    setPicking(false);
  };

  const conflictOptions = [
    {
      value: "skip",
      label: "Skip",
      desc: "Don't re-download files that already exist",
      icon: SkipForward,
    },
    {
      value: "replace",
      label: "Replace",
      desc: "Overwrite existing files with the same name",
      icon: Replace,
    },
    {
      value: "rename",
      label: "Keep both",
      desc: "Save as 'filename (1).mp4' if a conflict is found",
      icon: FilePlus,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Settings2 className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold leading-tight">
                Download Settings
              </h2>
              <p className="text-xs text-muted-foreground">
                {downloadCount === 1 ? "1 file" : `${downloadCount} files`} to
                download
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* Save Location */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Save Location
            </Label>

            {fsaSupported ? (
              <div className="flex flex-col gap-2">
                <button
                  onClick={pickDir}
                  disabled={picking}
                  className={`flex items-center gap-3 w-full rounded-xl border-2 px-4 py-3 text-left transition-all ${
                    picking
                      ? "border-border opacity-60 cursor-not-allowed"
                      : dirHandle && fsaWritable
                        ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                        : dirHandle && fsaWritable === false
                          ? "border-yellow-500/40 bg-yellow-500/5 hover:bg-yellow-500/10"
                          : "border-dashed border-border hover:border-primary/40 hover:bg-muted/50"
                  }`}
                >
                  <div
                    className={`p-1.5 rounded-lg shrink-0 ${
                      dirHandle && fsaWritable
                        ? "bg-primary/15"
                        : dirHandle && fsaWritable === false
                          ? "bg-yellow-500/15"
                          : "bg-muted"
                    }`}
                  >
                    {dirHandle && fsaWritable ? (
                      <FolderOpen className="w-4 h-4 text-primary" />
                    ) : dirHandle && fsaWritable === false ? (
                      <FolderOpen className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                    ) : (
                      <Folder className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {picking ? (
                      <>
                        <p className="text-sm font-medium">
                          Waiting for folder selection…
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Choose a folder in the dialog
                        </p>
                      </>
                    ) : dirHandle ? (
                      <>
                        <p className="text-sm font-medium truncate">
                          {dirHandle.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fsaWritable === false
                            ? "Write blocked — files go to Downloads instead"
                            : "Click to change folder"}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium">Choose a folder</p>
                        <p className="text-xs text-muted-foreground">
                          Select where files will be saved
                        </p>
                      </>
                    )}
                  </div>
                  {picking ? (
                    <Loader2 className="w-3.5 h-3.5 text-muted-foreground shrink-0 animate-spin" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                </button>

                {pickError && (
                  <p className="text-xs text-yellow-700 dark:text-yellow-400 flex items-start gap-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{pickError}</span>
                  </p>
                )}

                {!dirHandle && brave && (
                  <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <Info className="w-3 h-3 shrink-0 mt-0.5" />
                    Brave detected — folder selection may require disabling
                    Shields for this site.
                  </p>
                )}

                {!dirHandle && !brave && (
                  <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <Info className="w-3 h-3 shrink-0 mt-0.5" />
                    No folder selected — files will download to your browser's
                    default Downloads folder.
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border bg-muted/50 px-4 py-3 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Folder selection requires Chrome or Edge. Files will download
                  to your browser's default Downloads folder.
                </p>
              </div>
            )}
          </div>

          {/* Conflict Resolution — only relevant when folder is writable */}
          {dirHandle && fsaWritable && (
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                If File Already Exists
              </Label>
              <div className="flex flex-col gap-1.5">
                {conflictOptions.map(({ value, label, desc, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setConflictMode(value)}
                    className={`flex items-center gap-3 w-full rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                      conflictMode === value
                        ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                        : "border-border hover:border-border/70 hover:bg-muted/40"
                    }`}
                  >
                    <div
                      className={`p-1 rounded-md shrink-0 ${conflictMode === value ? "bg-primary/15" : "bg-muted"}`}
                    >
                      <Icon
                        className={`w-3.5 h-3.5 ${conflictMode === value ? "text-primary" : "text-muted-foreground"}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium ${conflictMode === value ? "text-foreground" : "text-foreground/80"}`}
                      >
                        {label}
                      </p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                        conflictMode === value
                          ? "border-primary bg-primary"
                          : "border-border"
                      }`}
                    >
                      {conflictMode === value && (
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t bg-muted/20">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onConfirm({ dirHandle, conflictMode })}
            disabled={picking}
            className="gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Start Downloading
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Download Mode Banner ──────────────────────────────────────────────────────
function DeviceModeBanner({ deviceMode, onToggle, disabled = false }) {
  return (
    <div
      className={`rounded-xl border p-3 sm:p-4 flex items-start gap-3 transition-colors ${
        deviceMode
          ? "bg-primary/5 border-primary/30"
          : "bg-muted/30 border-border"
      }`}
    >
      <div
        className={`mt-0.5 p-1.5 rounded-md shrink-0 ${deviceMode ? "bg-primary/10" : "bg-muted"}`}
      >
        {deviceMode ? (
          <Cpu className="w-4 h-4 text-primary" />
        ) : (
          <Server className="w-4 h-4 text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0 self-center">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold">
            {deviceMode ? "Device Mode — ON" : "Server Mode — ON"}
          </p>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-mono hidden sm:block${
              deviceMode
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {deviceMode ? "your device does the work" : "server does the work"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed hidden sm:block">
          {deviceMode
            ? "Server fetches stream URLs only. All processing happens in your browser — zero server bandwidth."
            : "Everything runs on the server. Simple and reliable, but uses server bandwidth and CPU."}
        </p>
      </div>

      <Button
        variant={deviceMode ? "outline" : "default"}
        size="sm"
        onClick={onToggle}
        disabled={disabled}
        className="shrink-0 gap-1.5 text-xs"
      >
        {deviceMode ? (
          <>
            <Server className="w-3 h-3" /> Use Server
          </>
        ) : (
          <>
            <Cpu className="w-3 h-3" /> Use My Device
          </>
        )}
      </Button>
    </div>
  );
}

// ── Single-Video Download Card ─────────────────────────────────────────────────
function VideoCard({ video, onDownload, download, globallyBusy = false }) {
  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("highest");
  const [downloadedWith, setDownloadedWith] = useState(null);

  const status = download?.status || "idle";
  const phase = download?.phase || "idle";
  const progress = download?.progress || 0;
  const log = download?.log || "";

  useEffect(() => {
    if (status === "done") setDownloadedWith({ format, quality });
    if (status === "downloading") setDownloadedWith(null);
  }, [status]);

  const selectionChanged =
    downloadedWith &&
    (downloadedWith.format !== format || downloadedWith.quality !== quality);
  const effectiveStatus = selectionChanged ? "idle" : status;

  const isLocked = globallyBusy || effectiveStatus === "downloading";

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="relative w-full aspect-video bg-muted overflow-hidden">
        <img
          src={video.thumbnail}
          alt={video.title}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.target.style.display = "none";
          }}
        />
        <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs font-mono px-1.5 py-0.5 rounded">
          {video.duration}
        </span>
      </div>

      <div className="p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-semibold leading-snug">
              {video.title}
            </h2>
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

        <div className="flex flex-wrap items-end gap-3 sm:gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Format</Label>
            <Tabs
              value={format}
              onValueChange={(v) => {
                if (!isLocked) {
                  setFormat(v);
                  setQuality("highest");
                }
              }}
            >
              <TabsList
                className={isLocked ? "opacity-50 pointer-events-none" : ""}
              >
                <TabsTrigger
                  value="mp4"
                  disabled={isLocked}
                  className="flex items-center gap-1.5"
                >
                  <Video className="w-3.5 h-3.5" />
                  <span>MP4</span>
                </TabsTrigger>
                <TabsTrigger
                  value="mp3"
                  disabled={isLocked}
                  className="flex items-center gap-1.5"
                >
                  <Music className="w-3.5 h-3.5" />
                  <span>MP3</span>
                </TabsTrigger>
                <TabsTrigger
                  value="thumbnail"
                  disabled={isLocked}
                  className="flex items-center gap-1.5"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>JPG</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {format !== "thumbnail" && (
            <div className="flex flex-col gap-1.5 w-40 sm:w-45">
              <Label>Quality</Label>
              <Select
                value={quality}
                onValueChange={setQuality}
                disabled={isLocked}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(format === "mp4" ? MP4_QUALITIES : MP3_QUALITIES).map(
                      (q) => (
                        <SelectItem key={q.value} value={q.value}>
                          {q.label}
                        </SelectItem>
                      ),
                    )}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="ml-auto">
            <Button
              onClick={() => {
                setDownloadedWith(null);
                onDownload(
                  video.videoId,
                  video.title,
                  format,
                  quality,
                  video.durationSeconds,
                );
              }}
              disabled={isLocked}
              size="default"
              className="gap-2"
            >
              {effectiveStatus === "downloading" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : effectiveStatus === "done" && format !== "thumbnail" ? (
                <RefreshCw className="w-4 h-4" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {effectiveStatus === "downloading"
                ? `${phase === "streaming" ? "Downloading" : phase === "converting" ? "Converting" : "Processing"} ${progress}%`
                : effectiveStatus === "done" && format !== "thumbnail"
                  ? "Download again"
                  : "Download"}
            </Button>
          </div>
        </div>

        {effectiveStatus === "downloading" && (
          <>
            <Progress value={progress} className="h-1.5" />
            {log && (
              <p className="text-xs text-muted-foreground font-mono">{log}</p>
            )}
          </>
        )}
        {effectiveStatus === "done" && (
          <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Download complete
          </p>
        )}
        {effectiveStatus === "error" && (
          <p className="text-sm text-destructive flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />{" "}
            {download.error || "Download failed"}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [dark, setDark] = useTheme();

  const [downloadMode, setDownloadMode] = useState("device");

  const [url, setUrl] = useState("");
  const [urlType, setUrlType] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [playlist, setPlaylist] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [downloads, setDownloads] = useState(new Map());
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [bulkThumbDownloading, setBulkThumbDownloading] = useState(false);
  const [thumbDownloads, setThumbDownloads] = useState(new Map());
  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("highest");
  const [sortBy, setSortBy] = useState("default");
  const [filter, setFilter] = useState("");
  const [completedSummary, setCompletedSummary] = useState(null);

  const [videoInfo, setVideoInfo] = useState(null);
  const [videoDownload, setVideoDownload] = useState(null);

  // ── Download Settings state ───────────────────────────────────────────────
  // Persisted across downloads within the session
  const [downloadSettings, setDownloadSettings] = useState(null); // { dirHandle, conflictMode }
  // Modal state
  const [settingsModal, setSettingsModal] = useState({
    open: false,
    downloadCount: 1,
    onConfirm: null,
  });

  /**
   * Opens the settings modal. Returns a Promise that resolves with the chosen
   * settings, or rejects if the user cancels.
   */
  const requestSettings = useCallback((downloadCount = 1) => {
    return new Promise((resolve, reject) => {
      setSettingsModal({
        open: true,
        downloadCount,
        onConfirm: (settings) => {
          setDownloadSettings(settings);
          setSettingsModal((s) => ({ ...s, open: false }));
          resolve(settings);
        },
        onCancel: () => {
          setSettingsModal((s) => ({ ...s, open: false }));
          reject(new Error("cancelled"));
        },
      });
    });
  }, []);

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
    setCompletedSummary(null);
  };

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
    setCompletedSummary(null);

    if (type === "playlist") {
      try {
        const res = await fetch(
          `/api/playlist?url=${encodeURIComponent(url.trim())}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch playlist");
        setPlaylist(data);
        setSelected(new Set(data.videos.map((v) => v.videoId)));
      } catch (err) {
        setError(err.message);
      }
    } else {
      try {
        const res = await fetch(
          `/api/video?url=${encodeURIComponent(url.trim())}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch video");
        setVideoInfo(data);
      } catch (err) {
        setError(err.message);
      }
    }
    setLoading(false);
  }, [url]);

  // ── Core download function ────────────────────────────────────────────────
  const downloadVideo = async (
    videoId,
    title,
    fmt,
    qual,
    durationSeconds = 300,
    isPlaylist = false,
    dlSettings,
  ) => {
    const updateDl = (patch) => {
      if (isPlaylist) {
        setDownloads((prev) => {
          const n = new Map(prev);
          n.set(videoId, { ...(n.get(videoId) || {}), ...patch });
          return n;
        });
      } else {
        setVideoDownload((prev) => ({ ...(prev || {}), ...patch }));
      }
    };

    updateDl({
      status: "downloading",
      phase: "processing",
      progress: 0,
      log: "",
    });

    // ── Device mode ───────────────────────────────────────────────────────────
    if (downloadMode === "device") {
      try {
        updateDl({ log: "Getting stream URLs from server…", progress: 3 });

        if (fmt === "thumbnail") {
          updateDl({ phase: "streaming", progress: 20 });
          const result = await downloadThumbnail(videoId, title, dlSettings);
          if (result?.skipped) {
            updateDl({
              status: "done",
              phase: "done",
              progress: 100,
              log: "Skipped — file already exists.",
            });
          } else {
            updateDl({ status: "done", phase: "done", progress: 100, log: "" });
          }
          return;
        }

        const res = await fetch(
          `/api/stream-url?videoId=${videoId}&format=${fmt}&quality=${qual}`,
        );
        const streamInfo = await res.json();
        if (!res.ok)
          throw new Error(streamInfo.error || "Failed to get stream URL");

        updateDl({
          progress: 8,
          log: "Stream URL obtained — your device takes over from here.",
        });

        const onProgress = (p) => updateDl({ progress: p });
        const onLog = (msg) => updateDl({ log: msg });

        let result;
        if (fmt === "mp3") {
          updateDl({ phase: "converting" });
          result = await deviceModeMP3(
            streamInfo,
            qual,
            title,
            onProgress,
            onLog,
            dlSettings,
          );
        } else {
          updateDl({ phase: "streaming" });
          result = await deviceModeMP4(
            streamInfo,
            title,
            onProgress,
            onLog,
            dlSettings,
          );
        }

        updateDl({
          status: "done",
          phase: "done",
          progress: 100,
          log: result?.skipped ? "Skipped — file already exists." : "",
          skipped: result?.skipped || false,
        });
      } catch (err) {
        console.error("Device mode download error:", err);
        updateDl({
          status: "error",
          phase: "error",
          progress: 0,
          error: err.message,
          log: "",
        });
      }
      return;
    }

    // ── Server mode ───────────────────────────────────────────────────────────
    if (fmt === "thumbnail") {
      try {
        updateDl({ phase: "streaming", progress: 20 });
        const result = await downloadThumbnail(videoId, title, dlSettings);
        if (result?.skipped) {
          updateDl({
            status: "done",
            phase: "done",
            progress: 100,
            log: "Skipped — file already exists.",
          });
        } else {
          updateDl({ status: "done", phase: "done", progress: 100, log: "" });
        }
      } catch (err) {
        updateDl({
          status: "error",
          phase: "error",
          progress: 0,
          error: err.message,
        });
      }
      return;
    }

    const formatSlowdown = fmt === "mp3" ? 2.5 : 1;
    const k = Math.min(
      0.07,
      Math.max(0.0004, (0.014 * (300 / durationSeconds)) / formatSlowdown),
    );
    let fakeProgress = 0;

    const fakeInterval = setInterval(() => {
      const step = Math.max(0.1, (85 - fakeProgress) * k);
      fakeProgress = Math.min(85, fakeProgress + step);
      if (isPlaylist) {
        setDownloads((prev) => {
          const n = new Map(prev);
          const cur = n.get(videoId);
          if (cur?.phase === "processing")
            n.set(videoId, { ...cur, progress: Math.round(fakeProgress) });
          return n;
        });
      } else {
        setVideoDownload((prev) =>
          prev?.phase === "processing"
            ? { ...prev, progress: Math.round(fakeProgress) }
            : prev,
        );
      }
    }, 800);

    try {
      const res = await fetch(
        `/api/download?videoId=${videoId}&format=${fmt}&quality=${qual}`,
      );
      clearInterval(fakeInterval);

      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "Download failed" }));
        if (e.vercelLimitError) {
          throw new Error(
            "Server Mode is unavailable on Vercel — please switch to Device Mode.",
          );
        }
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
        const sp = total
          ? Math.min(
              Math.round(
                (received / total) * (99 - startProgress) + startProgress,
              ),
              99,
            )
          : Math.min(startProgress + Math.round(received / 80000), 99);
        updateDl({ phase: "streaming", progress: sp });
      }

      const mimeType = fmt === "mp3" ? "audio/mpeg" : "video/mp4";
      const ext = fmt === "mp3" ? "mp3" : "mp4";
      const blob = new Blob(chunks, { type: mimeType });
      const safeName = title
        .replace(/[^\w\s\-]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .slice(0, 100);

      const result = await saveBlob(
        blob,
        `${safeName}.${ext}`,
        dlSettings?.dirHandle,
        dlSettings?.conflictMode,
      );

      updateDl({
        status: "done",
        phase: "done",
        progress: 100,
        log: result?.skipped ? "Skipped — file already exists." : "",
        skipped: result?.skipped || false,
      });
    } catch (err) {
      clearInterval(fakeInterval);
      updateDl({
        status: "error",
        phase: "error",
        progress: 0,
        error: err.message,
      });
    }
  };

  // ── Playlist selection helpers ──────────────────────────────────────────────
  const isDownloadingActive =
    bulkDownloading ||
    [...downloads.values()].some((d) => d.status === "downloading");

  const toggleVideo = (id) => {
    if (isDownloadingActive) return;
    setCompletedSummary(null);
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (!playlist || isDownloadingActive) return;
    setCompletedSummary(null);
    setSelected(
      selected.size === playlist.videos.length
        ? new Set()
        : new Set(playlist.videos.map((v) => v.videoId)),
    );
  };

  // ── Single video download entry point (with settings modal) ───────────────
  const handleSingleDownload = async (
    videoId,
    title,
    fmt,
    qual,
    durationSeconds,
  ) => {
    let settings;
    try {
      settings = await requestSettings(1);
    } catch {
      return; // user cancelled
    }
    downloadVideo(videoId, title, fmt, qual, durationSeconds, false, settings);
  };

  // ── Bulk playlist download entry point (with settings modal) ──────────────
  const downloadSelected = async () => {
    if (!playlist || selected.size === 0 || bulkDownloading) return;

    let settings;
    try {
      settings = await requestSettings(selected.size);
    } catch {
      return;
    }

    setCompletedSummary(null);
    setBulkDownloading(true);
    const prevSortBy = sortBy;
    setSortBy("selected");
    const initialMap = new Map();
    for (const id of selected)
      initialMap.set(id, { status: "idle", phase: "idle", progress: 0 });
    setDownloads(initialMap);
    for (const video of playlist.videos.filter((v) =>
      selected.has(v.videoId),
    )) {
      await downloadVideo(
        video.videoId,
        video.title,
        format,
        quality,
        video.durationSeconds,
        true,
        settings,
      );
      await new Promise((r) => setTimeout(r, 600));
    }
    setDownloads((prev) => {
      const allVals = [...prev.values()];
      const videos = new Map(
        [...prev.entries()].map(([id, d]) => [
          id,
          { status: d.status, error: d.error, skipped: d.skipped },
        ]),
      );
      setCompletedSummary({
        done: allVals.filter((d) => d.status === "done" && !d.skipped).length,
        skipped: allVals.filter((d) => d.status === "done" && d.skipped).length,
        error: allVals.filter((d) => d.status === "error").length,
        videos,
      });
      return new Map();
    });
    setBulkDownloading(false);
    setSortBy(prevSortBy);
  };

  // ── Bulk thumbnail download entry point (with settings modal) ─────────────
  const downloadSelectedThumbnails = async () => {
    if (!playlist || selected.size === 0 || bulkThumbDownloading) return;

    let settings;
    try {
      settings = await requestSettings(selected.size);
    } catch {
      return;
    }

    setBulkThumbDownloading(true);
    const prevSortBy = sortBy;
    setSortBy("selected");
    for (const video of playlist.videos.filter((v) =>
      selected.has(v.videoId),
    )) {
      setThumbDownloads((prev) => {
        const n = new Map(prev);
        n.set(video.videoId, "downloading");
        return n;
      });
      try {
        await downloadThumbnail(video.videoId, video.title, settings);
        setThumbDownloads((prev) => {
          const n = new Map(prev);
          n.set(video.videoId, "done");
          return n;
        });
      } catch (_) {
        setThumbDownloads((prev) => {
          const n = new Map(prev);
          n.set(video.videoId, "error");
          return n;
        });
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    setBulkThumbDownloading(false);
    setTimeout(() => setThumbDownloads(new Map()), 3000);
    setSortBy(prevSortBy);
  };

  const allDl = [...downloads.values()];
  const doneCount = allDl.filter(
    (d) => d.status === "done" && !d.skipped,
  ).length;
  const skippedCount = allDl.filter(
    (d) => d.status === "done" && d.skipped,
  ).length;
  const errorCount = allDl.filter((d) => d.status === "error").length;
  const activeCount = allDl.filter((d) => d.status === "downloading").length;
  const allSelected = playlist && selected.size === playlist.videos.length;

  const isBusy =
    loading ||
    bulkDownloading ||
    bulkThumbDownloading ||
    activeCount > 0 ||
    videoDownload?.status === "downloading";

  const displayedVideos = useMemo(() => {
    if (!playlist) return [];
    const sorted = sortVideos(playlist.videos, sortBy, selected);
    if (!filter) return sorted;
    const q = filter.toLowerCase();
    return sorted.filter(
      (v) =>
        v.title.toLowerCase().includes(q) || v.author.toLowerCase().includes(q),
    );
  }, [playlist, sortBy, filter, selected]);

  const typePill =
    urlType === "playlist"
      ? { label: "Playlist", icon: List }
      : urlType === "video"
        ? { label: "Video", icon: Video }
        : null;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* ── Download Settings Modal ── */}
      <DownloadSettingsModal
        open={settingsModal.open}
        downloadCount={settingsModal.downloadCount}
        initialSettings={downloadSettings}
        onConfirm={settingsModal.onConfirm}
        onCancel={settingsModal.onCancel}
      />

      {/* ── Header ── */}
      <header className="border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-primary" />
            <span className="font-semibold text-lg">YT Labs</span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDark(!dark)}
                disabled={isBusy}
              >
                {dark ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{dark ? "Light mode" : "Dark mode"}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 sm:py-8 flex flex-col gap-5 sm:gap-6">
        {/* ── Download Mode Banner ── */}
        <DeviceModeBanner
          deviceMode={downloadMode === "device"}
          disabled={isBusy}
          onToggle={() =>
            setDownloadMode((m) => (m === "server" ? "device" : "server"))
          }
        />

        {/* ── URL Input ── */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="yt-url">YouTube URL</Label>
            {typePill &&
              (() => {
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
            <input
              id="yt-url"
              placeholder="https://youtube.com/..."
              value={url}
              onChange={(e) => !isBusy && handleUrlChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isBusy && fetchData()}
              disabled={isBusy}
              className={`flex-1 min-w-0 px-3 py-2 text-sm font-mono bg-background text-foreground placeholder:text-muted-foreground ${isBusy ? " opacity-50 cursor-not-allowed" : ""}`}
            />
            {url && (
              <button
                onClick={!isBusy ? handleClear : undefined}
                disabled={isBusy}
                className={`flex items-center px-2 border-l border-input bg-background transition-colors${isBusy ? " opacity-50 cursor-not-allowed text-muted-foreground" : " text-muted-foreground hover:text-foreground"}`}
                tabIndex={-1}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <Button
              onClick={fetchData}
              disabled={isBusy || loading || !url.trim() || !urlType}
              className="rounded-none rounded-r-md border-l border-input shrink-0"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
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

        {/* ── Single Video ── */}
        {videoInfo && !playlist && (
          <VideoCard
            video={videoInfo}
            download={videoDownload}
            globallyBusy={isBusy}
            onDownload={handleSingleDownload}
          />
        )}

        {/* ── Playlist ── */}
        {playlist && (
          <>
            <Separator />

            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-semibold leading-tight">
                  {playlist.title}
                </h2>
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

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                {
                  icon: List,
                  label: "Videos",
                  value: String(playlist.videoCount),
                  sub:
                    playlist.unavailableCount > 0
                      ? `${playlist.unavailableCount} unavailable`
                      : null,
                },
                {
                  icon: Clock,
                  label: "Total",
                  value: playlist.totalDuration,
                  sub: null,
                },
                {
                  icon: BarChart2,
                  label: "Avg",
                  value: playlist.averageDuration,
                  sub: null,
                },
              ].map(({ icon: Icon, label, value, sub }) => (
                <div
                  key={label}
                  className="rounded-lg border bg-card p-3 sm:p-4 flex flex-col gap-1"
                >
                  <div className="flex items-center gap-1 text-muted-foreground text-xs">
                    <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </div>
                  <p className="text-lg sm:text-2xl font-mono font-medium leading-tight">
                    {value}
                  </p>
                  <p className="text-xs text-muted-foreground sm:hidden">
                    {label}
                  </p>
                  {sub && (
                    <p className="text-xs text-destructive font-mono">{sub}</p>
                  )}
                </div>
              ))}
            </div>

            <Separator />

            <div className="flex flex-wrap items-end gap-3 sm:gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Format</Label>
                <Tabs
                  value={format}
                  onValueChange={(v) => {
                    if (!isBusy) {
                      setFormat(v);
                      setQuality("highest");
                      setCompletedSummary(null);
                    }
                  }}
                >
                  <TabsList
                    className={isBusy ? "opacity-50 pointer-events-none" : ""}
                  >
                    <TabsTrigger
                      value="mp4"
                      disabled={isBusy}
                      className="flex items-center gap-1.5"
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>MP4</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="mp3"
                      disabled={isBusy}
                      className="flex items-center gap-1.5"
                    >
                      <Music className="w-3.5 h-3.5" />
                      <span>MP3</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="thumbnail"
                      disabled={isBusy}
                      className="flex items-center gap-1.5"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>JPG</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {format !== "thumbnail" && (
                <div className="flex flex-col gap-1.5 w-40 sm:w-45">
                  <Label>Quality</Label>
                  <Select
                    value={quality}
                    onValueChange={(v) => {
                      setQuality(v);
                      setCompletedSummary(null);
                    }}
                    disabled={isBusy}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(format === "mp4" ? MP4_QUALITIES : MP3_QUALITIES).map(
                          (q) => (
                            <SelectItem key={q.value} value={q.value}>
                              {q.label}
                            </SelectItem>
                          ),
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="ml-auto flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
                {/* Progress summary */}
                {(doneCount > 0 ||
                  skippedCount > 0 ||
                  errorCount > 0 ||
                  completedSummary) &&
                  format !== "thumbnail" && (
                    <div className="flex items-center gap-2 text-xs font-mono">
                      {(completedSummary ? completedSummary.done : doneCount) >
                        0 && (
                        <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">
                            {completedSummary
                              ? completedSummary.done
                              : doneCount}{" "}
                            done
                          </span>
                          <span className="sm:hidden">
                            {completedSummary
                              ? completedSummary.done
                              : doneCount}
                          </span>
                        </span>
                      )}
                      {(completedSummary
                        ? completedSummary.skipped
                        : skippedCount) > 0 && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <SkipForward className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">
                            {completedSummary
                              ? completedSummary.skipped
                              : skippedCount}{" "}
                            skipped
                          </span>
                          <span className="sm:hidden">
                            {completedSummary
                              ? completedSummary.skipped
                              : skippedCount}
                          </span>
                        </span>
                      )}
                      {(completedSummary
                        ? completedSummary.error
                        : errorCount) > 0 && (
                        <span className="flex items-center gap-1 text-destructive">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">
                            {completedSummary
                              ? completedSummary.error
                              : errorCount}{" "}
                            failed
                          </span>
                          <span className="sm:hidden">
                            {completedSummary
                              ? completedSummary.error
                              : errorCount}
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                <Button
                  onClick={
                    format === "thumbnail"
                      ? downloadSelectedThumbnails
                      : downloadSelected
                  }
                  disabled={selected.size === 0 || isBusy}
                  size="sm"
                  className="sm:h-10 sm:px-4"
                >
                  {bulkDownloading || bulkThumbDownloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : doneCount > 0 &&
                    doneCount === selected.size &&
                    format !== "thumbnail" ? (
                    <RefreshCw className="w-4 h-4" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">
                    {bulkDownloading || bulkThumbDownloading
                      ? "Downloading..."
                      : `Download (${selected.size})`}
                  </span>
                  <span className="sm:hidden">{selected.size}</span>
                </Button>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-2 sm:gap-7 flex-wrap">
              <div className="flex items-center gap-2">
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
              </div>
              <div className="flex items-center gap-1.5">
                <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <Select
                  value={sortBy}
                  onValueChange={(v) => {
                    setSortBy(v);
                    setCompletedSummary(null);
                  }}
                  disabled={isBusy}
                >
                  <SelectTrigger className="h-8 w-32.5 sm:w-38.75 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {SORT_OPTIONS.map((o) => (
                        <SelectItem
                          key={o.value}
                          value={o.value}
                          className="text-xs"
                        >
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:ml-auto relative w-full sm:w-auto">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Filter..."
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setCompletedSummary(null);
                  }}
                  disabled={isBusy}
                  className="pl-8 h-8 w-full sm:w-40 text-sm"
                />
              </div>
            </div>

            <div className="rounded-lg border divide-y overflow-hidden">
              {displayedVideos.length === 0 ? (
                <p className="text-center py-12 text-sm text-muted-foreground">
                  No videos match your filter.
                </p>
              ) : (
                displayedVideos.map((video) => {
                  const dl =
                    downloads.get(video.videoId) ??
                    (completedSummary?.videos?.get(video.videoId)
                      ? {
                          ...completedSummary.videos.get(video.videoId),
                          progress: 0,
                          phase: "idle",
                          log: "",
                        }
                      : undefined);
                  const status = dl?.status || "idle";
                  const phase = dl?.phase || "idle";
                  const isSelected = selected.has(video.videoId);

                  return (
                    <div
                      key={video.videoId}
                      onClick={() => toggleVideo(video.videoId)}
                      className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 transition-all select-none ${isDownloadingActive ? "cursor-not-allowed" : "cursor-pointer"} ${isSelected ? "bg-background hover:bg-muted/40" : "opacity-40 grayscale hover:opacity-60"}`}
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
                          onError={(e) => {
                            e.target.style.display = "none";
                          }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate leading-snug">
                          {video.title}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs text-muted-foreground truncate">
                            {video.author}
                          </p>
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
                          <Progress
                            value={dl.progress}
                            className="h-1 mt-1.5"
                          />
                        )}
                        {status === "downloading" && dl?.log && (
                          <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                            {dl.log}
                          </p>
                        )}
                        {status === "done" && dl?.skipped && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
                            Skipped
                          </p>
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
                      <div
                        className="shrink-0 w-5 flex justify-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {status === "downloading" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {phase === "converting"
                                ? `Converting — ${dl.progress}%`
                                : phase === "streaming"
                                  ? `Downloading — ${dl.progress}%`
                                  : `Processing — ${dl.progress}%`}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {status === "done" && !dl?.skipped && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default">
                                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>Done</TooltipContent>
                          </Tooltip>
                        )}
                        {status === "done" && dl?.skipped && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default">
                                <SkipForward className="w-3.5 h-3.5 text-muted-foreground" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Skipped — file already exists
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {status === "error" && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default">
                                <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {dl.error || "Error"}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ── Empty state ── */}
        {!playlist && !videoInfo && !loading && !error && (
          <div className="flex flex-col items-center text-center gap-6 my-auto">
            <div className="rounded-2xl border bg-muted/50 p-4">
              <FlaskConical className="w-8 h-8 text-primary" />
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="font-semibold text-lg">
                Download YouTube videos &amp; playlists
              </p>
              <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                Paste a video or playlist URL above. No API key, no sign-up.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 w-full max-w-sm">
              {[
                { icon: Video, label: "MP4", sub: "Up to 4K" },
                { icon: Music, label: "MP3", sub: "Up to 320kbps" },
                { icon: ImageIcon, label: "Thumbnail", sub: "Max resolution" },
              ].map(({ icon: Icon, label, sub }) => (
                <div
                  key={label}
                  className="rounded-xl border bg-card p-3 flex flex-col items-center gap-1.5"
                >
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <p className="text-xs font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{sub}</p>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Works with single videos, playlists, and shorts
            </p>
          </div>
        )}
      </main>

      <footer className="border-t py-4 text-center text-xs text-muted-foreground font-mono">
        Made with ♥ by{" "}
        <a
          href="https://github.com/Ujjwal2327/YT-Labs"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground transition-colors"
        >
          Ujjwal
        </a>
      </footer>
    </div>
  );
}
