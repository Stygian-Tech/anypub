"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { CalendarDaysIcon, ClockIcon, ImageIcon } from "lucide-react";
import { toast } from "sonner";
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
import { uploadImage } from "@/lib/asset-api";
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

function TagInput({ tags, onCommit }: { tags: string[]; onCommit: (tags: string[]) => void }) {
  const [value, setValue] = React.useState(() => tags.join(", "));

  function commit() {
    const committedTags = [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
    setValue(committedTags.join(", "));
    onCommit(committedTags);
  }

  return (
    <Input
      id="tags"
      value={value}
      placeholder="release, accessibility, updates"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

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
  const coverInputRef = React.useRef<HTMLInputElement>(null);
  const [uploadingCover, setUploadingCover] = React.useState(false);

  async function uploadCover(file?: File) {
    if (!draft || !file) return;
    setUploadingCover(true);
    try {
      const asset = await uploadImage(draft.accountDID, file, file.name.replace(/\.[^.]+$/, ""));
      onDraftChange({ coverAssetID: asset.id });
      toast.success("Cover image uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload cover image");
    } finally {
      setUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

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
                <TagInput key={draft.id} tags={draft.tags} onCommit={(tags) => onDraftChange({ tags })} />
              </Field>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ImageIcon />
                    Cover
                  </CardTitle>
                  <CardDescription>Upload a cover image to publish it as a `coverImage` blob.</CardDescription>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <input
                    ref={coverInputRef}
                    className="sr-only"
                    type="file"
                    accept="image/*"
                    aria-label="Choose cover image"
                    onChange={(event) => void uploadCover(event.target.files?.[0])}
                  />
                  <Button variant="outline" size="sm" disabled={uploadingCover} onClick={() => coverInputRef.current?.click()}>
                    {uploadingCover ? "Uploading…" : draft.coverAssetID ? "Replace" : "Upload"}
                  </Button>
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
