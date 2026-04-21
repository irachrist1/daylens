import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/session";
import { AppsDayClient } from "@/app/components/AppsDayClient";

export default async function AppsPage() {
  const session = await getSession();
  if (!session) redirect("/");

  return <AppsDayClient />;
}
