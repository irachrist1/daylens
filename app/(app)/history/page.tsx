import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/session";
import { HistoryClient } from "./HistoryClient";
import { appPath } from "@/app/lib/basePath";

export default async function HistoryPage() {
  const session = await getSession();
  if (!session) redirect(appPath("/"));

  return <HistoryClient />;
}
