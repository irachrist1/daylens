import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/session";
import { appPath } from "@/app/lib/basePath";

export default async function RecapPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect(appPath("/"));

  const resolvedSearchParams = await searchParams;
  const dateParam = resolvedSearchParams?.date;
  const date =
    typeof dateParam === "string"
      ? dateParam
      : Array.isArray(dateParam)
        ? dateParam[0]
        : undefined;

  redirect(date ? appPath(`/chat?date=${date}`) : appPath("/chat"));
}
