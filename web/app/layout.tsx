import type { Metadata, Viewport } from "next";
import { Alegreya, Alegreya_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const display = Alegreya({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--font-display", display: "swap" });
const ui = Alegreya_Sans({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-ui", display: "swap" });

export const metadata: Metadata = {
  title: "Hundredfold: a Commander deck from five cards",
  description: "Pick five Magic cards. Claude, using the mtg-master skill, builds a complete Bracket 3 Commander deck around them and checks every card on Scryfall.",
};

// every page gets a per-request CSP nonce (proxy.ts), so pages render per request
export const dynamic = "force-dynamic";

export const viewport: Viewport = { themeColor: "#121733", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
