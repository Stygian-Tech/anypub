import { FileTextIcon, LeafIcon, NewspaperIcon, NotebookTextIcon } from "lucide-react";
import type { Publication } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PublicationIcon({
  publication,
  className,
}: {
  publication: Publication;
  className?: string;
}) {
  const Icon =
    publication.host === "leaflet"
      ? LeafIcon
      : publication.host === "offprint"
        ? NewspaperIcon
        : publication.host === "pckt"
          ? NotebookTextIcon
          : FileTextIcon;

  return (
    <span className={cn("bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border", className)}>
      <Icon className="size-1/2 min-h-2.5 min-w-2.5" aria-hidden />
    </span>
  );
}
