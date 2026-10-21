import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { connection } from "next/server";
import { brand } from "@/lib/brand";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: brand.name,
    template: `%s · ${brand.name}`,
  },
  description:
    "Live golf scoring for courses, pros, and players — real-time leaderboards, scorecards, and WHS/USGA handicapping.",
};

// Rendered per request (never prerendered): the CSP nonce applied in
// src/middleware.ts must be available when the <script> tags render, and a
// build-time-prerendered shell would ship scripts without a nonce that the
// 'strict-dynamic' policy then blocks.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();

  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${fraunces.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
