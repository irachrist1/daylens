import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/session";
import { appPath } from "@/app/lib/basePath";

export default async function AppsDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const session = await getSession();
  if (!session) redirect(appPath("/"));

  const { date } = await params;
  redirect(appPath(`/apps?date=${date}`));
}
