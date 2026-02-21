import { NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(req) {
  const videoId = req.nextUrl.searchParams.get("videoId");
  const format = req.nextUrl.searchParams.get("format") || "mp4";
  const quality = req.nextUrl.searchParams.get("quality") || "highest";

  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }

  try {
    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
    const title = info.videoDetails.title;
    const formats = info.formats;

    let selectedFormat;
    let downloadUrl;
    let mimeType;
    let qualityLabel;

    if (format === "mp3") {
      const audioFormats = ytdl
        .filterFormats(formats, "audioonly")
        .filter((f) => f.url)
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));

      if (audioFormats.length === 0) {
        return NextResponse.json(
          { error: "No audio formats available" },
          { status: 404 }
        );
      }

      let idx = 0;
      if (quality === "low") idx = audioFormats.length - 1;
      else if (quality === "medium") idx = Math.floor(audioFormats.length / 2);

      selectedFormat = audioFormats[Math.min(idx, audioFormats.length - 1)];
      downloadUrl = selectedFormat.url;
      mimeType = selectedFormat.mimeType || "audio/webm";
      qualityLabel = `${selectedFormat.audioBitrate || "?"}kbps`;
    } else {
      const videoFormats = ytdl
        .filterFormats(formats, "videoandaudio")
        .filter((f) => f.url)
        .sort(
          (a, b) =>
            parseInt(b.qualityLabel || "0") - parseInt(a.qualityLabel || "0")
        );

      if (videoFormats.length === 0) {
        return NextResponse.json(
          { error: "No video formats available" },
          { status: 404 }
        );
      }

      const qualityMap = {
        highest: [2160, 1440, 1080, 720, 480, 360, 240, 144],
        "1080p": [1080, 720, 480, 360],
        "720p": [720, 480, 360, 240],
        "480p": [480, 360, 240],
        "360p": [360, 240, 144],
        lowest: [144, 240, 360, 480],
      };

      const preferredHeights = qualityMap[quality] || qualityMap["highest"];

      let picked = videoFormats[0];
      for (const h of preferredHeights) {
        const match = videoFormats.find(
          (f) => parseInt(f.qualityLabel || "0") === h
        );
        if (match) {
          picked = match;
          break;
        }
      }

      selectedFormat = picked;
      downloadUrl = selectedFormat.url;
      mimeType = selectedFormat.mimeType || "video/mp4";
      qualityLabel = selectedFormat.qualityLabel || "?";
    }

    const audioQualities = ytdl
      .filterFormats(formats, "audioonly")
      .filter((f) => f.url)
      .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))
      .map((f) => ({
        label: `${f.audioBitrate || "?"}kbps`,
        value: f.audioBitrate?.toString(),
      }))
      .filter((v, i, a) => a.findIndex((x) => x.value === v.value) === i);

    const videoQualities = ytdl
      .filterFormats(formats, "videoandaudio")
      .filter((f) => f.url)
      .sort(
        (a, b) =>
          parseInt(b.qualityLabel || "0") - parseInt(a.qualityLabel || "0")
      )
      .map((f) => ({ label: f.qualityLabel, value: f.qualityLabel }))
      .filter((v, i, a) => a.findIndex((x) => x.value === v.value) === i);

    return NextResponse.json({
      videoId,
      title,
      downloadUrl,
      mimeType,
      qualityLabel,
      format,
      audioQualities,
      videoQualities,
      fileExtension: format === "mp3" ? "webm" : "mp4",
    });
  } catch (err) {
    console.error("Stream URL error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to get stream URL" },
      { status: 500 }
    );
  }
}