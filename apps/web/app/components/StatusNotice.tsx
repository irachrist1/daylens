import { type RemoteNoticeTone } from "@/app/lib/remoteUi";

const TONE_STYLES: Record<RemoteNoticeTone, string> = {
  neutral: "border-outline-variant/15 bg-surface-low text-on-surface",
  warning: "border-warning/20 bg-warning/10 text-on-surface",
  error: "border-error/20 bg-error/10 text-on-surface",
};

export function StatusNotice({
  title,
  detail,
  tone = "neutral",
  className = "",
}: {
  title: string;
  detail: string;
  tone?: RemoteNoticeTone;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${TONE_STYLES[tone]} ${className}`.trim()}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-on-surface-variant">{detail}</p>
    </div>
  );
}
