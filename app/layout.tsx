import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "./components/ServiceWorker";
import { PHProvider } from "./providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://christian-tonny.dev"),
  title: "Daylens",
  description:
    "Cross-platform work history for your laptop. Local-first activity tracking for grounded timeline recall, AI queries, and editor-ready context.",
  manifest: "/daylens/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Daylens",
  },
  icons: {
    icon: [{ url: "/daylens/app-icon.png", type: "image/png" }],
    apple: [{ url: "/daylens/app-icon.png", type: "image/png" }],
    shortcut: "/daylens/app-icon.png",
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
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-surface text-on-surface font-sans">
        <PHProvider>
          {children}
        </PHProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
