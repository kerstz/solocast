import type { Metadata, Viewport } from "next";
import { Press_Start_2P, VT323 } from "next/font/google";
import type { ReactNode } from "react";
import { SessionProvider } from "../lib/session/SessionProvider";
import "./globals.css";

// Mock-up fonts, self-hosted at build time by next/font (no client-side request).
const pixel = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
  display: "swap",
});

const lcd = VT323({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-lcd",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SoloCast",
  description: "SoloCast: one channel, live.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#008080",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${pixel.variable} ${lcd.variable}`}>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
