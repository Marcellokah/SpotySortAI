import type { Metadata, Viewport } from "next";
import { ReactNode } from "react";
import { Providers } from "@/components/providers";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#1DB954",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: "SpotySort.AI | Organize Your Spotify Library with AI",
    template: "%s | SpotySort.AI",
  },
  description: "Automatically sort your Spotify Liked Songs into perfectly curated playlists using Google Gemini AI.",
  keywords: ["Spotify", "AI", "Playlist Generator", "Music Organizer", "Gemini AI", "SpotySort", "Spotify Sorter"],
  authors: [{ name: "SpotySort.AI Team" }],
  creator: "SpotySort.AI",
  publisher: "SpotySort.AI",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: "SpotySort.AI | Organize Your Spotify Library with AI",
    description: "Automatically sort your Spotify Liked Songs into perfectly curated playlists using Google Gemini AI.",
    siteName: "SpotySort.AI",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SpotySort.AI | Organize Your Spotify Library with AI",
    description: "Automatically sort your Spotify Liked Songs into perfectly curated playlists using Google Gemini AI.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
