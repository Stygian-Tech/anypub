import { FlaskConicalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ExperimentalBadge({ className }: { className?: string }) {
  return (
    <Badge variant="accent" className={cn("gap-1", className)}>
      <FlaskConicalIcon className="size-3" aria-hidden />
      Experimental
    </Badge>
  );
}

export function ExperimentalGlyph({ className }: { className?: string }) {
  return (
    <FlaskConicalIcon
      aria-label="Experimental"
      className={cn("size-3 shrink-0 text-[#4f7da7] dark:text-[#8db5d8]", className)}
    />
  );
}
