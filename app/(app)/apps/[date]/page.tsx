import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/session";

export default async function AppsDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const { date } = await params;
  redirect(`/apps?date=${date}`);
}
