import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HackathonLanding } from "./hackathon/components/HackathonLanding";
import { appPath, assetPath } from "@/app/lib/basePath";

export const metadata: Metadata = {
  title: "Daylens — Your digital life, made searchable on demand",
  description:
    "Daylens is a local-first personal memory system for your laptop. Watches what you do, enriches it with Claude, and lets you ask anything in plain language. Open source, local-first, macOS-ready.",
  openGraph: {
    title: "Daylens — Your digital life, made searchable on demand",
    description:
      "Local-first memory system for your laptop. Ask anything about what you did, read, or learned, and get a real answer.",
    url: "/daylens",
    images: [
      {
        url: assetPath("/hackathon/01-timeline-day.png"),
        width: 1280,
        height: 800,
        alt: "Daylens today view",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Daylens — Your digital life, made searchable on demand",
    description:
      "Local-first memory system for your laptop. Open source. CBC Spring 2026.",
    images: [assetPath("/hackathon/01-timeline-day.png")],
  },
};

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  // Preserve old QR-code redirect behavior from the previous landing.
  if (params.token && /^[0-9a-f]{32}$/i.test(params.token)) {
    redirect(appPath(`/link?token=${params.token}`));
  }
  return <HackathonLanding />;
}
