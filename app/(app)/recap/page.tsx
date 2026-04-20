import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/session";
import { RecapClient } from "./RecapClient";

export default async function RecapPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const resolvedSearchParams = await searchParams;
  const dateParam = resolvedSearchParams?.date;
  const date =
    typeof dateParam === "string"
      ? dateParam
      : Array.isArray(dateParam)
        ? dateParam[0]
        : undefined;

  return <RecapClient initialDate={date} />;
}
