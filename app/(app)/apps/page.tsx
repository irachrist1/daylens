import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/session";
import { AppsDayClient } from "@/app/components/AppsDayClient";
import { appPath } from "@/app/lib/basePath";

export default async function AppsPage() {
  const session = await getSession();
  if (!session) redirect(appPath("/"));

  return <AppsDayClient />;
}
