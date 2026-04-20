import { redirect } from "next/navigation";
import { GlobalChat } from "@/app/components/GlobalChat";
import { getSession } from "@/app/lib/session";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[]; prompt?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }

  const resolvedSearchParams = await searchParams;
  const dateParam = resolvedSearchParams?.date;
  const promptParam = resolvedSearchParams?.prompt;
  const date =
    typeof dateParam === "string"
      ? dateParam
      : Array.isArray(dateParam)
        ? dateParam[0]
        : undefined;
  const prompt =
    typeof promptParam === "string"
      ? promptParam
      : Array.isArray(promptParam)
        ? promptParam[0]
        : undefined;

  return (
    <div className="mx-auto flex max-w-2xl flex-col px-4 sm:px-6 py-4 sm:py-6">
      <GlobalChat initialMessages={[]} date={date} initialPrompt={prompt} />
    </div>
  );
}
