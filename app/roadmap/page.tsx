import { RoadmapPageClient } from "../components/RoadmapPageClient";

export const metadata = {
  title: "Roadmap — Daylens",
  description:
    "See what Daylens is improving next, what still needs validation, and what remains queued across the unified Daylens product.",
};

export default function RoadmapPage() {
  return <RoadmapPageClient />;
}
