import type { Metadata } from "next";
import { HackathonLanding } from "./components/HackathonLanding";

export const metadata: Metadata = {
  title: "Daylens — Your digital life, made searchable on demand",
  description:
    "Daylens is a local-first personal memory system for your laptop. Ask anything about what you did, read, or learned, and get a real answer. Built for the CBC Spring 2026 Hackathon.",
  openGraph: {
    title: "Daylens — Your digital life, made searchable on demand",
    description:
      "A local-first personal memory system. Watches what you do, enriches it with Claude, and lets you ask anything in plain language.",
    images: [
      {
        url: "/hackathon/02-timeline-week.png",
        width: 1280,
        height: 800,
        alt: "Daylens week view",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Daylens — Your digital life, made searchable on demand",
    description:
      "Local-first personal memory system for your laptop. Built for CBC Spring 2026.",
    images: ["/hackathon/02-timeline-week.png"],
  },
};

export default function HackathonPage() {
  return <HackathonLanding />;
}
