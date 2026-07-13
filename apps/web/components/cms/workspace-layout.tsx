"use client";

import * as React from "react";
import { GripVerticalIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  columnLayoutBounds,
  defaultColumnLayout,
  sanitizeColumnLayout,
  type ColumnLayout,
} from "@/lib/preferences";
import { cn } from "@/lib/utils";

const columnLayoutStorageKey = "anypub:column-layout";
const resizeStep = 16;
type ColumnKey = keyof ColumnLayout;

export function useWorkspaceLayout() {
  const [columnLayout, setColumnLayout] = React.useState<ColumnLayout>(defaultColumnLayout);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(columnLayoutStorageKey);
        setColumnLayout(sanitizeColumnLayout(stored ? JSON.parse(stored) : undefined));
      } catch {
        setColumnLayout(defaultColumnLayout);
      }
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  React.useEffect(() => {
    if (hydrated) {
      window.localStorage.setItem(columnLayoutStorageKey, JSON.stringify(columnLayout));
    }
  }, [columnLayout, hydrated]);

  function resizeColumn(key: ColumnKey, delta: number) {
    setColumnLayout((current) => sanitizeColumnLayout({ ...current, [key]: current[key] + delta }));
  }

  function beginColumnResize(
    key: ColumnKey,
    direction: 1 | -1,
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = columnLayout[key];
    const ownerDocument = event.currentTarget.ownerDocument;
    const previousCursor = ownerDocument.body.style.cursor;
    const previousUserSelect = ownerDocument.body.style.userSelect;
    ownerDocument.body.style.cursor = "col-resize";
    ownerDocument.body.style.userSelect = "none";

    function finishResize() {
      ownerDocument.body.style.cursor = previousCursor;
      ownerDocument.body.style.userSelect = previousUserSelect;
      ownerDocument.removeEventListener("pointermove", moveResize);
      ownerDocument.removeEventListener("pointerup", finishResize);
      ownerDocument.removeEventListener("pointercancel", finishResize);
    }

    function moveResize(moveEvent: PointerEvent) {
      const delta = (moveEvent.clientX - startX) * direction;
      setColumnLayout((current) => sanitizeColumnLayout({ ...current, [key]: startWidth + delta }));
    }

    ownerDocument.addEventListener("pointermove", moveResize);
    ownerDocument.addEventListener("pointerup", finishResize);
    ownerDocument.addEventListener("pointercancel", finishResize);
  }

  return { columnLayout, bounds: columnLayoutBounds, resizeColumn, beginColumnResize };
}

export function ColumnResizeHandle({
  className,
  label,
  value,
  min,
  max,
  onPointerDown,
  onNudge,
}: {
  className?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onNudge: (delta: number) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="separator"
          tabIndex={0}
          aria-label={label}
          aria-orientation="vertical"
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={Math.round(value)}
          onPointerDown={onPointerDown}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              onNudge(-resizeStep);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              onNudge(resizeStep);
            }
          }}
          className={cn(
            "group relative min-h-0 w-[9px] cursor-col-resize items-center justify-center bg-background outline-none transition-colors hover:bg-accent focus-visible:bg-accent",
            className,
          )}
        >
          <span className="h-full w-px bg-border transition-colors group-hover:bg-ring group-focus-visible:bg-ring" />
          <GripVerticalIcon className="text-muted-foreground pointer-events-none absolute size-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </div>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
