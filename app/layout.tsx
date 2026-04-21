import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "./components/ServiceWorker";
import { PHProvider } from "./providers";
import { assetPath } from "./lib/basePath";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://christian-tonny.dev"),
  title: "Daylens",
  description:
    "Cross-platform work history for your laptop. Local-first activity tracking for grounded timeline recall, AI queries, and editor-ready context.",
  manifest: assetPath("/manifest.json"),
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Daylens",
  },
  icons: {
    icon: [{ url: assetPath("/app-icon.png"), type: "image/png" }],
    apple: [{ url: assetPath("/app-icon.png"), type: "image/png" }],
    shortcut: assetPath("/app-icon.png"),
  },
};

export const viewport: Viewport = {
  themeColor: "#7CB9F5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-surface text-on-surface font-sans">
        <PHProvider>
          {children}
        </PHProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
