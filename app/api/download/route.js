// 📁 app/api/download/route.js
import { getYtDlp, withRetry } from "@/lib/ytdlp";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export const runtime = "nodejs";
export const maxDuration = 300;

// Format selector strategy:
//  - Prefer m4a audio (AAC) — always mp4-container-compatible, no re-encode needed.
//  - Fall back to any audio — postprocessorArgs will re-encode to AAC as safety net.
//  - No [ext=mp4] video restriction — VP9/AV1 are YouTube's best quality streams.
//  - No player_client=ios — web client gives full DASH access (4K, VP9, AV1, HDR).
const VIDEO_FORMAT_MAP = {
  highest: "bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
  "1080p": "bestvideo[height<=1080]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]",
  "720p":  "bestvideo[height<=720]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]",
  "480p":  "bestvideo[height<=480]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]",
  "360p":  "bestvideo[height<=360]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[height<=360]",
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
  // Vercel Hobby plan caps all functions at 60s regardless of maxDuration.
  // Server-mode downloads (which need 2-5min for large files) will always
  // timeout on Vercel. Tell the user to switch to Device Mode instead.
  if (process.env.VERCEL) {
    return NextResponse.json(
      {
        error:
          "Server-mode download is not supported on Vercel due to execution time limits. " +
          "Please switch to Device Mode — it downloads and converts entirely in your browser " +
          "with no server timeout.",
        vercelLimitError: true,
      },
      { status: 503 }
    );
  }

  const { searchParams } = req.nextUrl;
  const videoId = searchParams.get("videoId");
  const format  = searchParams.get("format")  || "mp4";
  const quality = searchParams.get("quality") || "highest";

  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }

  const videoUrl  = `https://www.youtube.com/watch?v=${videoId}`;
  const tmpDir    = os.tmpdir();
  const uid       = randomUUID();
  const youtubeDl = await getYtDlp();

  const baseOpts = {
    quiet:      true,
    noWarnings: true,
  };

  // Fetch title (best-effort)
  let safeName = `media_${videoId}`;
  try {
    const info = await withRetry(() =>
      youtubeDl(videoUrl, { dumpSingleJson: true, ...baseOpts })
    );
    safeName = (info.title || safeName)
      .replace(/[^\w\s\-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 100);
  } catch (_) {}

  // ── MP3 ────────────────────────────────────────────────────────────────────
  if (format === "mp3") {
    const bitrate      = AUDIO_BITRATE_MAP[quality] || "192k";
    const rawAudioPath = path.join(tmpDir, `${uid}_audio`);
    const mp3Path      = path.join(tmpDir, `${uid}.mp3`);

    try {
      await withRetry(() =>
        youtubeDl(videoUrl, {
          format: "bestaudio/best",
          output: rawAudioPath + ".%(ext)s",
          ...baseOpts,
        })
      );

      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`${uid}_audio`));
      if (!files.length) throw new Error("yt-dlp did not produce an audio file");
      const downloadedAudio = path.join(tmpDir, files[0]);

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

      const stat       = fs.statSync(mp3Path);
      const fileStream = fs.createReadStream(mp3Path);
      const webStream  = new ReadableStream({
        start(controller) {
          fileStream.on("data",  chunk => controller.enqueue(chunk));
          fileStream.on("end",   ()    => { controller.close(); cleanup(mp3Path); });
          fileStream.on("error", err  => { controller.error(err); cleanup(mp3Path); });
        },
        cancel() { fileStream.destroy(); cleanup(mp3Path); },
      });

      return new Response(webStream, {
        status: 200,
        headers: {
          "Content-Type":        "audio/mpeg",
          "Content-Disposition": `attachment; filename="${safeName}.mp3"`,
          "Content-Length":      String(stat.size),
          "Cache-Control":       "no-store",
        },
      });

    } catch (err) {
      cleanup(mp3Path);
      console.error("MP3 download error:", err);
      return NextResponse.json({ error: err?.message || "MP3 download failed" }, { status: 500 });
    }
  }

  // ── MP4 ────────────────────────────────────────────────────────────────────
  const mp4Path  = path.join(tmpDir, `${uid}.mp4`);
  const ytFormat = VIDEO_FORMAT_MAP[quality] || VIDEO_FORMAT_MAP.highest;

  try {
    await withRetry(() =>
      youtubeDl(videoUrl, {
        format:            ytFormat,
        output:            mp4Path,
        mergeOutputFormat: "mp4",
        ffmpegLocation:    ffmpegInstaller.path,
        postprocessorArgs: "ffmpeg:-c:v copy -c:a aac -b:a 192k",
        ...baseOpts,
      })
    );

    if (!fs.existsSync(mp4Path)) throw new Error("yt-dlp did not produce a video file");

    const stat       = fs.statSync(mp4Path);
    const fileStream = fs.createReadStream(mp4Path);
    const webStream  = new ReadableStream({
      start(controller) {
        fileStream.on("data",  chunk => controller.enqueue(chunk));
        fileStream.on("end",   ()    => { controller.close(); cleanup(mp4Path); });
        fileStream.on("error", err  => { controller.error(err); cleanup(mp4Path); });
      },
      cancel() { fileStream.destroy(); cleanup(mp4Path); },
    });

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type":        "video/mp4",
        "Content-Disposition": `attachment; filename="${safeName}.mp4"`,
        "Content-Length":      String(stat.size),
        "Cache-Control":       "no-store",
      },
    });

  } catch (err) {
    cleanup(mp4Path);
    console.error("MP4 download error:", err);
    return NextResponse.json({ error: err?.message || "MP4 download failed" }, { status: 500 });
  }
}