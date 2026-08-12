"use client";

import { format, parseISO } from "date-fns";
import { CalendarDaysIcon, ClockIcon, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PcktPublishingNotice } from "@/components/cms/pckt-publishing-notice";
import { calendarItemsFromDrafts } from "@/lib/cms-data";
import type { Draft, DraftStatus, Publication } from "@/lib/types";

const statusVariant: Record<DraftStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  scheduled: "secondary",
  publishing: "secondary",
  published: "default",
  failed: "destructive",
};
const sideTabsListClassName = "grid w-full grid-cols-3 gap-1 p-1";
const sideTabsTriggerClassName = "min-w-0 px-1 text-center leading-none";
const sideTabsTriggerStyle = { fontSize: "clamp(0.75rem, 0.95vw, 0.875rem)" };

export function RightPanel({
  draft,
  selectedPublication,
  calendarItems,
  scheduledDate,
  onScheduledDate,
  onSchedule,
  onDraftChange,
}: {
  draft?: Draft;
  selectedPublication?: Publication;
  calendarItems: ReturnType<typeof calendarItemsFromDrafts>;
  scheduledDate?: Date;
  onScheduledDate: (date?: Date) => void;
  onSchedule: () => void;
  onDraftChange: (patch: Partial<Draft>) => void;
}) {
  return (
    <aside className="hidden min-h-0 border-l xl:flex xl:flex-col">
      <Tabs defaultValue="metadata" className="min-h-0 flex-1">
        <div className="flex h-14 shrink-0 items-center border-b px-3">
          <TabsList className={sideTabsListClassName}>
            <TabsTrigger value="metadata" className={sideTabsTriggerClassName} style={sideTabsTriggerStyle}>
              <span className="min-w-0 truncate">Meta</span>
            </TabsTrigger>
            <TabsTrigger value="schedule" className={sideTabsTriggerClassName} style={sideTabsTriggerStyle}>
              <span className="min-w-0 truncate">Schedule</span>
            </TabsTrigger>
            <TabsTrigger value="calendar" className={sideTabsTriggerClassName} style={sideTabsTriggerStyle}>
              <span className="min-w-0 truncate">Calendar</span>
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="metadata" className="min-h-0 flex-1 overflow-auto p-4">
          {draft ? (
            <FieldGroup>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    Publication
                    {selectedPublication?.host ? (
                      <Badge variant="secondary">{selectedPublication.host}</Badge>
                    ) : !selectedPublication ? (
                      <Badge variant="destructive">Unavailable</Badge>
                    ) : null}
                  </CardTitle>
                  <CardDescription>
                    {selectedPublication?.themeType
                      ?? selectedPublication?.url
                      ?? "This publication is no longer available in the discovered account records."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-sm">
                  <span className="truncate">{selectedPublication?.name ?? "Publication unavailable"}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {selectedPublication?.url ?? draft.publicationURI}
                  </span>
                  {selectedPublication?.host === "pckt" ? <PcktPublishingNotice className="mt-2" /> : null}
                </CardContent>
              </Card>
              <Field>
                <FieldLabel htmlFor="path">Path</FieldLabel>
                <Input
                  id="path"
                  value={draft.path ?? ""}
                  onChange={(event) => onDraftChange({ path: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="excerpt">Excerpt</FieldLabel>
                <Textarea
                  id="excerpt"
                  value={draft.excerpt ?? ""}
                  onChange={(event) => onDraftChange({ excerpt: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tags">Tags</FieldLabel>
                <Input
                  id="tags"
                  value={draft.tags.join(", ")}
                  onChange={(event) =>
                    onDraftChange({
                      tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
                    })
                  }
                />
              </Field>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ImageIcon />
                    Cover
                  </CardTitle>
                  <CardDescription>Device upload and Unsplash covers publish as `coverImage` blobs.</CardDescription>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Button variant="outline" size="sm">Upload</Button>
                  <Button variant="outline" size="sm">Unsplash</Button>
                </CardContent>
              </Card>
            </FieldGroup>
          ) : null}
        </TabsContent>
        <TabsContent value="schedule" className="p-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClockIcon />
                Publish date
              </CardTitle>
              <CardDescription>Scheduling creates or updates a community calendar event.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="justify-start">
                    <CalendarDaysIcon data-icon="inline-start" />
                    {scheduledDate ? format(scheduledDate, "PPP") : "Choose date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar mode="single" selected={scheduledDate} onSelect={onScheduledDate} />
                </PopoverContent>
              </Popover>
              <Button onClick={onSchedule} disabled={!draft || !scheduledDate}>
                <CalendarDaysIcon data-icon="inline-start" />
                Schedule
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="calendar" className="min-h-0 overflow-auto p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Article</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calendarItems.map((item) => (
                <TableRow key={item.draftID}>
                  <TableCell className="max-w-40 truncate">{item.title}</TableCell>
                  <TableCell>{item.date ? format(parseISO(item.date), "MMM d") : "No date"}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[item.status]}>{item.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </aside>
  );
}
