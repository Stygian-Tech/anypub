"use client";

import * as React from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon } from "lucide-react";
import type { ChevronProps } from "react-day-picker";
import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

function CalendarChevron({ orientation = "right", className, ...props }: ChevronProps) {
  const Icon =
    orientation === "left"
      ? ChevronLeftIcon
      : orientation === "right"
        ? ChevronRightIcon
        : orientation === "up"
          ? ChevronUpIcon
          : ChevronDownIcon;

  return <Icon className={cn("size-4", className)} aria-hidden="true" {...props} />;
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-1 xl:p-3", className)}
      classNames={{
        months: "flex flex-col gap-4",
        month: "flex flex-col gap-4",
        month_caption: "flex h-8 items-center justify-center",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-1 top-1 flex items-center justify-between xl:inset-x-3 xl:top-3",
        button_previous: cn(buttonVariants({ variant: "outline", size: "icon" }), "size-11 bg-transparent p-0 opacity-60 hover:opacity-100 xl:size-7"),
        button_next: cn(buttonVariants({ variant: "outline", size: "icon" }), "size-11 bg-transparent p-0 opacity-60 hover:opacity-100 xl:size-7"),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "text-muted-foreground w-11 rounded-md text-[0.8rem] font-normal xl:w-8",
        week: "mt-2 flex w-full",
        day: "relative size-11 p-0 text-center text-sm xl:size-8",
        day_button: cn(buttonVariants({ variant: "ghost" }), "size-11 p-0 font-normal aria-selected:opacity-100 xl:size-8"),
        selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        today: "bg-accent text-accent-foreground",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: CalendarChevron,
      }}
      {...props}
    />
  );
}

export { Calendar };
