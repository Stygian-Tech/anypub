import { AlertTriangleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function UnknownPublishingNotice({ className }: { className?: string }) {
  return (
    <p className={cn("text-muted-foreground flex items-start gap-1.5 text-xs", className)}>
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>This blog type could not be identified. Formatting will likely not work as expected.</span>
    </p>
  );
}
