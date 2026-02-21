import ytdl from "@distube/ytdl-core";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import { NextResponse } from "next/server";
import { PassThrough } from "stream";

// Point fluent-ffmpeg at the bundled static binary
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export const runtime = "nodejs";
export const maxDuration = 120; // longer for conversion

export async function GET(req) {
  const { searchParams } = req.nextUrl;
  const videoId = searchParams.get("videoId");
  const format = searchParams.get("format") || "mp4";
  const quality = searchParams.get("quality") || "highest";

  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const info = await ytdl.getInfo(videoUrl);
    const title = info.videoDetails.title;
    const safeName = title.replace(/[^\w\s\-]/g, "").trim().replace(/\s+/g, "_");

    if (format === "mp3") {
      // Use a videoandaudio stream as the source (audio-only streams 403 due to
      // signature issues). Pick lowest video resolution → smallest input, same audio.
      const combinedFormats = ytdl
        .filterFormats(info.formats, "videoandaudio")
        .sort(
          (a, b) =>
            parseInt(a.qualityLabel || "9999") -
            parseInt(b.qualityLabel || "9999")
        );

      if (!combinedFormats.length) {
        return NextResponse.json({ error: "No suitable format found" }, { status: 404 });
      }

      // quality param maps to bitrate for the output MP3
      const bitrate = quality === "highest" ? "320k" : quality === "medium" ? "192k" : "128k";

      // Always pick the smallest combined stream as the ffmpeg input source
      const sourceFormat = combinedFormats[0];

      // Pull the ytdl stream
      const ytdlStream = ytdl(videoUrl, {
        format: sourceFormat,
        requestOptions: {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          },
        },
      });

      // PassThrough as the output sink ffmpeg writes into
      const passThrough = new PassThrough();

      ffmpeg(ytdlStream)
        .audioCodec("libmp3lame")
        .audioBitrate(bitrate)
        .format("mp3")
        .on("error", (err) => {
          console.error("ffmpeg error:", err.message);
          passThrough.destroy(err);
        })
        .pipe(passThrough, { end: true });

      // Convert Node PassThrough → Web ReadableStream
      const webStream = new ReadableStream({
        start(controller) {
          passThrough.on("data", (chunk) => controller.enqueue(chunk));
          passThrough.on("end", () => controller.close());
          passThrough.on("error", (err) => controller.error(err));
        },
        cancel() {
          passThrough.destroy();
          ytdlStream.destroy();
        },
      });

      return new Response(webStream, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Disposition": `attachment; filename="${safeName}.mp3"`,
          "X-Quality": bitrate,
          "Cache-Control": "no-store",
        },
      });
    } else {
      // ── MP4 video download ────────────────────────────────────────────────
      const qualityHeightMap = {
        highest: null,
        "1080p": 1080,
        "720p": 720,
        "480p": 480,
        "360p": 360,
        lowest: 0,
      };

      const targetHeight = qualityHeightMap[quality];

      const videoFormats = ytdl
        .filterFormats(info.formats, "videoandaudio")
        .sort(
          (a, b) =>
            parseInt(b.qualityLabel || "0") - parseInt(a.qualityLabel || "0")
        );

      if (!videoFormats.length) {
        return NextResponse.json({ error: "No video formats found" }, { status: 404 });
      }

      let chosenFormat;
      if (targetHeight === null) {
        chosenFormat = videoFormats[0];
      } else if (quality === "lowest") {
        chosenFormat = videoFormats[videoFormats.length - 1];
      } else {
        chosenFormat =
          videoFormats.find(
            (f) => parseInt(f.qualityLabel || "0") <= targetHeight
          ) || videoFormats[videoFormats.length - 1];
      }

      const stream = ytdl(videoUrl, {
        format: chosenFormat,
        requestOptions: {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          },
        },
      });

      const webStream = new ReadableStream({
        start(controller) {
          stream.on("data", (chunk) => controller.enqueue(chunk));
          stream.on("end", () => controller.close());
          stream.on("error", (err) => controller.error(err));
        },
        cancel() {
          stream.destroy();
        },
      });

      return new Response(webStream, {
        status: 200,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Disposition": `attachment; filename="${safeName}.mp4"`,
          "X-Quality": chosenFormat.qualityLabel || "?",
          "Cache-Control": "no-store",
        },
      });
    }
  } catch (err) {
    console.error("Download error:", err);
    return NextResponse.json(
      { error: err?.message || "Download failed" },
      { status: 500 }
    );
  }
}