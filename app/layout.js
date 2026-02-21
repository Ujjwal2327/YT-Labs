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
  description: "Download YouTube playlists as MP3 or MP4. No API key, no signup required.",
  keywords: ["youtube", "playlist", "downloader", "mp3", "mp4", "yt-dlp"],
  authors: [{ name: "YT Labs" }],
  openGraph: {
    title: "YT Labs — YouTube Playlist Downloader",
    description: "Download YouTube playlists as MP3 or MP4. No API key required.",
    type: "website",
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
