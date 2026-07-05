import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { V2Landing } from "./landing/V2Landing";
import { appPath, assetPath } from "@/app/lib/basePath";

export const metadata: Metadata = {
  title: "Daylens | See your whole day",
  description:
    "Daylens turns the work scattered across your computer into one clear, searchable memory of what you actually got done.",
  openGraph: {
    title: "Daylens | See your whole day",
    description:
      "Turn the work scattered across your computer into one clear, searchable memory of what you actually got done.",
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
    title: "Daylens | See your whole day",
    description:
      "A local-first memory for the work you do on your computer.",
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
  return <V2Landing />;
}
