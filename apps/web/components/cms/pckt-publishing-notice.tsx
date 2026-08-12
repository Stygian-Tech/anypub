import { TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const pcktPublishingNotice =
  "AnyPub will publish this article to your PDS, but pckt does not currently import externally published posts. It will not appear on your pckt site.";

export function PcktPublishingNotice({ className }: { className?: string }) {
  return (
    <p
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200",
        className,
      )}
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{pcktPublishingNotice}</span>
    </p>
  );
}
