// Every page's document: the head the single-page site had (fonts, analytics, the link
// preview), the drifting marbles behind everything, and the two page-wide behaviours,
// the marble flip and the old #/ links. Each route's own frame is components/Shell.tsx.
import type { Metadata, Viewport } from "next";

import { Ambient } from "../components/Marble";
import { LegacyHash, MarbleFlip } from "../components/Behaviours";
import { SITE_TITLE, pageTitle } from "../lib/rules";

import "./styles/base.css";
import "./styles/board.css";
import "./styles/player.css";
import "./styles/vs.css";
import "./styles/dialogs.css";
import "./styles/rail.css";
import "./styles/workshop.css";
import "./styles/players.css";
import "./styles/maps.css";
import "./styles/daily.css";
import "./styles/desktop.css";

const DESCRIPTION =
  "Circuit and Workshop leaderboards for Ballest of Them All, read straight from Steam.";

export const metadata: Metadata = {
  metadataBase: new URL("https://ballest.willness.dev"),
  title: { default: SITE_TITLE, template: pageTitle("%s") },
  description: DESCRIPTION,
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "ballest.willness.dev",
    title: SITE_TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Ballest of Them All: three marbles on a gold, silver and bronze podium.",
      },
    ],
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#ffd447",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- the root layout loads them for every page */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Bungee&family=Chakra+Petch:wght@400;500;600;700&display=swap"
        />
        <script
          defer
          data-domain="ballest.willness.dev"
          src="https://plausible-analytics-ce-production-d9c9.up.railway.app/js/script.js"
        />
      </head>
      <body>
        <Ambient />
        {children}
        <LegacyHash />
        <MarbleFlip />
      </body>
    </html>
  );
}
