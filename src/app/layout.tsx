import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Bricolage_Grotesque } from "next/font/google";

import { FriendRequestBanner } from "@/components/FriendRequestBanner";
import { PresenceBeat } from "@/components/PresenceBeat";
import { SiteHeader } from "@/components/SiteHeader";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/Toaster";

import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
});
const body = Atkinson_Hyperlegible({ subsets: ["latin"], variable: "--font-body", weight: ["400", "700"] });

export const metadata: Metadata = {
  title: "Matching Pairs",
  description: "Turn over two tiles, find the pair. A memory game to play with friends.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1F4FA3" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1524" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <SiteHeader />
          <PresenceBeat />
          <FriendRequestBanner />
          <Toaster />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
