// 📁 app/api/download/route.js
import { create } from "youtube-dl-exec";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "crypto";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export const runtime = "nodejs";
export const maxDuration = 300;

const binName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const binPath = path.join(process.cwd(), "node_modules", "youtube-dl-exec", "bin", binName);
const youtubeDl = create(binPath);

const VIDEO_FORMAT_MAP = {
  highest: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
  "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]",
  "720p":  "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]",
  "480p":  "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]",
  "360p":  "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[height<=360]",
  lowest:  "worstvideo+worstaudio/worst",
};

const AUDIO_BITRATE_MAP = {
  highest: "320k",
  medium:  "192k",
  low:     "128k",
};

function cleanup(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
  }
}

export async function GET(req) {
  const { searchParams } = req.nextUrl;
  const videoId = searchParams.get("videoId");
  const format  = searchParams.get("format")  || "mp4";
  const quality = searchParams.get("quality") || "highest";

  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const tmpDir = os.tmpdir();
  const uid = randomUUID();

  // Fetch title
  let safeName = `media_${videoId}`;
  try {
    const info = await youtubeDl(videoUrl, {
      dumpSingleJson: true,
      quiet: true,
      noWarnings: true,
    });
    safeName = (info.title || safeName)
      .replace(/[^\w\s\-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 100);
  } catch (_) {}

  if (format === "mp3") {
    // ── MP3 ────────────────────────────────────────────────────────────────
    // Step 1: yt-dlp downloads best audio to a temp file (e.g. .webm / .m4a)
    // Step 2: ffmpeg converts that temp file to proper .mp3
    // Step 3: stream the .mp3 to browser, delete both temp files

    const bitrate = AUDIO_BITRATE_MAP[quality] || "192k";
    const rawAudioPath = path.join(tmpDir, `${uid}_audio`); // yt-dlp adds extension
    const mp3Path = path.join(tmpDir, `${uid}.mp3`);

    try {
      // Download best audio to temp file — yt-dlp picks the extension
      await youtubeDl(videoUrl, {
        format: "bestaudio/best",
        output: rawAudioPath + ".%(ext)s",
        quiet: true,
        noWarnings: true,
      });

      // Find what file yt-dlp actually created
      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`${uid}_audio`));
      if (!files.length) throw new Error("yt-dlp did not produce an audio file");
      const downloadedAudio = path.join(tmpDir, files[0]);

      // Convert to mp3 with ffmpeg
      await new Promise((resolve, reject) => {
        ffmpeg(downloadedAudio)
          .audioCodec("libmp3lame")
          .audioBitrate(bitrate)
          .format("mp3")
          .on("error", reject)
          .on("end", resolve)
          .save(mp3Path);
      });

      cleanup(downloadedAudio);

      // Stream the mp3 to browser
      const stat = fs.statSync(mp3Path);
      const fileStream = fs.createReadStream(mp3Path);

      const webStream = new ReadableStream({
        start(controller) {
          fileStream.on("data", (chunk) => controller.enqueue(chunk));
          fileStream.on("end", () => {
            controller.close();
            cleanup(mp3Path);
          });
          fileStream.on("error", (err) => {
            controller.error(err);
            cleanup(mp3Path);
          });
        },
        cancel() {
          fileStream.destroy();
          cleanup(mp3Path);
        },
      });

      return new Response(webStream, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Disposition": `attachment; filename="${safeName}.mp3"`,
          "Content-Length": String(stat.size),
          "Cache-Control": "no-store",
        },
      });

    } catch (err) {
      cleanup(mp3Path, path.join(tmpDir, `${uid}_audio.webm`), path.join(tmpDir, `${uid}_audio.m4a`));
      console.error("MP3 download error:", err);
      return NextResponse.json({ error: err?.message || "MP3 download failed" }, { status: 500 });
    }

  } else {
    // ── MP4 ────────────────────────────────────────────────────────────────
    // yt-dlp downloads video+audio and merges them into a temp .mp4
    // Then we stream that file to the browser

    const mp4Path = path.join(tmpDir, `${uid}.mp4`);
    const ytFormat = VIDEO_FORMAT_MAP[quality] || VIDEO_FORMAT_MAP.highest;

    try {
      await youtubeDl(videoUrl, {
        format: ytFormat,
        output: mp4Path,
        mergeOutputFormat: "mp4",
        quiet: true,
        noWarnings: true,
        // Ensure ffmpeg is available for merging
        ffmpegLocation: ffmpegInstaller.path,
      });

      if (!fs.existsSync(mp4Path)) {
        throw new Error("yt-dlp did not produce a video file");
      }

      const stat = fs.statSync(mp4Path);
      const fileStream = fs.createReadStream(mp4Path);

      const webStream = new ReadableStream({
        start(controller) {
          fileStream.on("data", (chunk) => controller.enqueue(chunk));
          fileStream.on("end", () => {
            controller.close();
            cleanup(mp4Path);
          });
          fileStream.on("error", (err) => {
            controller.error(err);
            cleanup(mp4Path);
          });
        },
        cancel() {
          fileStream.destroy();
          cleanup(mp4Path);
        },
      });

      return new Response(webStream, {
        status: 200,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Disposition": `attachment; filename="${safeName}.mp4"`,
          "Content-Length": String(stat.size),
          "Cache-Control": "no-store",
        },
      });

    } catch (err) {
      cleanup(mp4Path);
      console.error("MP4 download error:", err);
      return NextResponse.json({ error: err?.message || "MP4 download failed" }, { status: 500 });
    }
  }
}