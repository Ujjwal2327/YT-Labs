import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "YT Labs",
  description: "Download YouTube videos & playlists as MP4, MP3, or thumbnails. No API key, no sign-up. Runs in your browser or on the server.",
  keywords: ["youtube", "downloader", "youtube playlist downloader", "youtube video downloader", "mp3", "mp4", "thumbnail", "yt-dlp", "ffmpeg", "no api key", "free"],
  authors: [{ name: "Ujjwal", url: "https://github.com/Ujjwal2327" }],
  creator: "Ujjwal",
  openGraph: {
    title: "YT Labs — YouTube Video & Playlist Downloader",
    description: "Download YouTube videos & playlists as MP4, MP3, or thumbnails. No API key, no sign-up required.",
    type: "website",
    siteName: "YT Labs",
  },
  twitter: {
    card: "summary_large_image",
    title: "YT Labs — YouTube Video & Playlist Downloader",
    description: "Download YouTube videos & playlists as MP4, MP3, or thumbnails. No API key, no sign-up required.",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
