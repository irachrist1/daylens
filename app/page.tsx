import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LandingClient } from "./components/LandingClient";
import { EasterEggs } from "./components/EasterEggs";
import { appPath } from "@/app/lib/basePath";

export const metadata: Metadata = {
  title: "Daylens — Searchable work history for your laptop",
  description:
    "Daylens is a cross-platform laptop activity tracker that turns apps, windows, browser activity, files, and work sessions into searchable, local-first, AI-ready work history.",
  openGraph: {
    title: "Daylens — Searchable work history for your laptop",
    description:
      "Cross-platform laptop activity tracking for macOS, Windows, and Linux. Local-first, evidence-grounded, and built so you and your AI tools can ask what actually happened.",
    url: "/daylens",
    images: [
      {
        url: "/daylens/screenshots/screenshot-hero-timeline-dark.png",
        width: 1200,
        height: 800,
        alt: "Daylens timeline showing reconstructed work sessions and evidence",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Daylens — Searchable work history for your laptop",
    description:
      "Local-first work history for macOS, Windows, and Linux, built for grounded questions and editor-ready context.",
    images: ["/daylens/screenshots/screenshot-hero-timeline-dark.png"],
  },
};

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  // If a ?token= param arrives on the root (from old QR codes), forward to /link
  if (params.token && /^[0-9a-f]{32}$/i.test(params.token)) {
    redirect(appPath(`/link?token=${params.token}`));
  }
  return (
    <>
      {/* hey, you're looking at the source. we respect that. here's a secret: the app is even more interesting. → daylens.app */}
      <LandingClient />
      <EasterEggs />
    </>
  );
}
