import { getSession } from "@/app/lib/session";
import { getConvexClient } from "@/app/lib/convex";
import { api } from "../../../convex/_generated/api";
import { redirect } from "next/navigation";

export default async function AppsIndexPage() {
  const session = await getSession();
  if (!session) redirect("/");

  const client = getConvexClient(session.token);
  const latestDate = await client.query(api.remoteSync.latestTimelineDate, {});

  if (!latestDate) {
    redirect("/dashboard");
  }

  redirect(`/apps/${latestDate}`);
}
