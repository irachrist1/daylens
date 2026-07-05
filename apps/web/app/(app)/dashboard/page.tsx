import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/session";
import { DashboardClient } from "./DashboardClient";
import { appPath } from "@/app/lib/basePath";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect(appPath("/"));

  return <DashboardClient />;
}
