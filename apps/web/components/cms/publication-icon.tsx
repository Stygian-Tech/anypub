"use client";

import * as React from "react";
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
  const [failedURL, setFailedURL] = React.useState<string>();
  const Icon =
    publication.host === "leaflet"
      ? LeafIcon
      : publication.host === "offprint"
        ? NewspaperIcon
        : publication.host === "pckt"
          ? NotebookTextIcon
        : FileTextIcon;
  const showImage = Boolean(publication.iconURL) && publication.iconURL !== failedURL;

  return (
    <span className={cn("bg-muted text-muted-foreground relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border", className)}>
      {showImage ? (
        // PDS blob hosts are dynamic per account, so a native image avoids a brittle host allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={publication.iconURL}
          alt={`${publication.name} icon`}
          className="size-full object-cover"
          onError={() => setFailedURL(publication.iconURL)}
        />
      ) : (
        <Icon className="size-1/2 min-h-2.5 min-w-2.5" aria-hidden />
      )}
    </span>
  );
}
